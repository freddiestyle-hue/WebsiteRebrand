#!/usr/bin/env python3
"""
Builds prospect records for the Teardown Prospecting Airtable base.

Reads:
- /Users/gandalf/Documents/Codex/2026-05-14/i-need-the-prospect-list-which/rivett_linkedin_prospect_list_1104.csv
  (source contact details: name, email, title, LinkedIn URL)
- /tmp/rivett_advertisers_1104_real.csv
  (advertiser scan results: meta/google/linkedin ad counts)
- /tmp/rivett_audit_56_advertisers.csv
  (already-audited subset: score, slug, hero_dimension, hero_strength, hero_diagnosis)
- /tmp/rivett_audit_409.csv (when ready)
  (newly-audited 409: same shape as the 56)

Writes:
- /tmp/rivett_prospect_records.jsonl (one record per line)

For each advertiser:
- Resolves contact (best from `best_contacts_json`)
- Computes hero_one_liner from dimension + diagnosis
- Templates Introduction DM (LinkedIn connect note, <=200 chars)
- Templates Follow-up DM (post-accept, V1.1 template with audit URL + Cal.com)

Skips rows that fail (missing contact, missing audit data, etc.) and reports.
"""

import csv
import json
import re
import os
from datetime import date

# --- Inputs --------------------------------------------------------------

CONTACTS_CSV = "/Users/gandalf/Documents/Codex/2026-05-14/i-need-the-prospect-list-which/rivett_linkedin_prospect_list_1104.csv"
ADVERTISERS_CSV = "/tmp/rivett_advertisers_1104_real.csv"
AUDIT_56_CSV = "/tmp/rivett_audit_56_advertisers.csv"
AUDIT_409_CSV = "/tmp/rivett_audit_409.csv"

OUT_JSONL = "/tmp/rivett_prospect_records.jsonl"

# --- DM templates --------------------------------------------------------

INTRO_DM_TEMPLATE = (
    "Hey {first_name}, used to work for Nick Huber. Spotted {company} in his "
    "audience and wanted to reach out. Want to connect?"
)

FOLLOWUP_DM_TEMPLATE = """Hey {first_name},

Thanks for connecting. Did a quick analysis of {company} this morning. {one_liner}

If you're spending on paid right now, this is costing you. Full audit here: {audit_url}

Happy to walk through it - cal.com/fred-style/discovery (30 min, no deck. Same kind of teardown I used to run for Nick's operators when I was at Somewhere.)

Fred"""

# --- One-liner mapping (mirrors pick-hero.ts ONE_LINER) ------------------

ONE_LINER = {
    "conversion": (
        "You're paying for paid traffic that lands on a page where the "
        "form is buried and the phone number isn't tappable."
    ),
    "mobile": (
        "On mobile your phone number isn't tappable and the primary CTA "
        "falls below the first screen."
    ),
    "email": (
        "Domain's missing SPF or DMARC - half your outbound is hitting "
        "spam before anyone reads it."
    ),
    "pagespeed": (
        "Homepage takes over 4 seconds to render its main content on "
        "mobile - most paid clicks bounce before they see the offer."
    ),
    "seo": (
        "Title tag, H1, or meta description is empty - Google's guessing "
        "what you sell."
    ),
    "aeo": (
        "ChatGPT and Perplexity can't structure your services to cite. "
        "The competitors who did show up in AI answers."
    ),
    "tracking": (
        "Site fires 30+ pixels but doesn't track the events that actually "
        "predict revenue - you're spending blind."
    ),
    "ads": (
        "Ads are running but landing on the homepage instead of a page "
        "built to convert - you're paying full-funnel CAC into a dead end."
    ),
    "stack": (
        "Site runs on an aging builder platform with no in-house person "
        "to maintain it."
    ),
}
CLEAN_ONE_LINER = (
    "Site reads clean on the surface - worth a 15 min comparison of what "
    "your competitors aren't doing well off-page."
)


def build_ads_landing_one_liner(diagnosis: str) -> str:
    """Extract the actual PSI score from the diagnosis text for ads_landing."""
    m = re.search(r"scoring (\d+)/100", diagnosis)
    if m:
        score = int(m.group(1))
        return (
            f"Paid clicks land on a page scoring {score}/100 - Google's "
            f"penalising the spend with higher CPC and throttled delivery."
        )
    return (
        "Paid clicks land on a page Google considers penalty-band - "
        "Quality Score drops, CPC inflates, delivery throttles."
    )


def get_one_liner(dimension: str, diagnosis: str) -> str:
    if dimension == "ads_landing":
        return build_ads_landing_one_liner(diagnosis)
    if dimension == "clean":
        return CLEAN_ONE_LINER
    return ONE_LINER.get(dimension, CLEAN_ONE_LINER)


# --- Contact extraction --------------------------------------------------


def parse_best_contact(best_contacts_json: str) -> dict:
    """Pick the strongest contact from best_contacts_json (priority sources first)."""
    if not best_contacts_json:
        return {}
    try:
        contacts = json.loads(best_contacts_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not contacts:
        return {}
    # Priority order for source field, strongest first.
    SOURCE_PRIORITY = [
        "priority",
        "enriched",
        "operator",
        "business_email",
        "dr_vass",
        "freddie_full",
        "scout_linkedin",
    ]
    by_source = {c.get("source"): c for c in contacts if isinstance(c, dict)}
    for src in SOURCE_PRIORITY:
        if src in by_source and by_source[src].get("name"):
            return by_source[src]
    # Fallback: first contact with a name.
    for c in contacts:
        if isinstance(c, dict) and c.get("name"):
            return c
    return contacts[0] if isinstance(contacts[0], dict) else {}


def first_name_from_full(full: str) -> str:
    if not full:
        return ""
    full = full.strip()
    # Strip "Dr. ", "Mr. ", etc.
    full = re.sub(r"^(Dr|Mr|Mrs|Ms|Miss|Mx)\.?\s+", "", full, flags=re.IGNORECASE)
    parts = full.split()
    return parts[0] if parts else ""


# Fallback: extract first name from email local-part. Skips role-shaped
# inboxes (info@, hello@, sales@) that won't yield a real first name.
ROLE_INBOXES = {
    "info", "hello", "sales", "marketing", "admin", "support", "contact",
    "team", "office", "hq", "press", "media", "billing", "accounts",
    "accounting", "finance", "hr", "jobs", "careers", "noreply", "no-reply",
    "service", "help", "social", "media", "general", "inquiries", "ops",
    "operations",
}


def first_name_from_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    local = email.split("@", 1)[0].lower()
    # Strip plus-tags: sam+marketing@ -> sam
    local = local.split("+", 1)[0]
    if local in ROLE_INBOXES:
        return ""
    # Split on common separators, take the first token.
    parts = re.split(r"[._\-]", local)
    candidate = parts[0] if parts else ""
    # Only accept alphabetic, length >= 2.
    if not re.match(r"^[a-z]{2,}$", candidate):
        return ""
    return candidate.capitalize()


def first_name_from_linkedin(url: str) -> str:
    """Last resort: pull from linkedin.com/in/<slug>. Often unreliable
    because slugs are concatenated and ambiguous (e.g. samcstoddard)."""
    if not url:
        return ""
    m = re.search(r"linkedin\.com/in/([a-z0-9-]+)", url, flags=re.IGNORECASE)
    if not m:
        return ""
    slug = m.group(1).lower()
    # Slugs like "john-smith" are easy.
    parts = slug.split("-")
    if len(parts) >= 2 and parts[0].isalpha() and len(parts[0]) >= 2:
        return parts[0].capitalize()
    # Concatenated slugs are too risky to parse heuristically.
    return ""


# --- Load source data ----------------------------------------------------


def load_csv_dict(path: str, key_field: str = "domain") -> dict:
    out = {}
    if not os.path.exists(path):
        return out
    with open(path) as f:
        for r in csv.DictReader(f):
            d = r.get(key_field, "").strip()
            if d:
                out[d] = r
    return out


def main():
    contacts = load_csv_dict(CONTACTS_CSV)
    advertisers = {d: r for d, r in load_csv_dict(ADVERTISERS_CSV).items() if r.get("has_ads") == "true"}

    # Combine audit results from both 56 and 409 batches (if 409 exists yet).
    audits = {}
    for path in (AUDIT_56_CSV, AUDIT_409_CSV):
        for d, r in load_csv_dict(path).items():
            if r.get("success") == "true":
                audits[d] = r

    print(f"Source: contacts={len(contacts)}, advertisers={len(advertisers)}, audits={len(audits)}")

    records = []
    skipped = []
    for domain, adv in advertisers.items():
        contact_row = contacts.get(domain, {})
        company = (contact_row.get("company") or adv.get("company") or "").strip()
        if not company:
            company = domain.split(".")[0]

        best = parse_best_contact(contact_row.get("best_contacts_json", ""))
        full_name = (best.get("name") or contact_row.get("Primary Contact Name") or "").strip()
        first_name = first_name_from_full(full_name)
        # When the explicit name is missing, LinkedIn slugs in `first-last-id`
        # shape are the highest-confidence source because they're populated
        # from LinkedIn's profile, which the prospect maintains. We check this
        # BEFORE email because initial-based emails like rcooper@ would yield
        # "Rcooper" while LinkedIn says rob-cooper-06092a4a → "Rob".
        if not first_name:
            li_candidate = (best.get("linkedin_url") or contact_row.get("LinkedIn Profile Link") or "")
            first_name = first_name_from_linkedin(li_candidate)
        if not first_name:
            # Email local-part still helps for clean cases (sam@, jane@, etc.)
            # where the LinkedIn slug is concatenated (samcstoddard) and unparseable.
            email_candidate = (best.get("email") or contact_row.get("Primary Contact Email") or "")
            first_name = first_name_from_email(email_candidate)

        title = (best.get("title") or contact_row.get("Primary Contact Title") or "").strip()
        email = (best.get("email") or contact_row.get("Primary Contact Email") or "").strip()
        linkedin_url = (best.get("linkedin_url") or contact_row.get("LinkedIn Profile Link") or "").strip()
        # Some LinkedIn URLs in source data are http:// - upgrade to https:// for cleanliness.
        if linkedin_url.startswith("http://"):
            linkedin_url = "https://" + linkedin_url[len("http://"):]

        industry = contact_row.get("industry", "").strip()

        # Ad counts.
        meta_ads = int(adv.get("meta_ads") or 0) if adv.get("meta_ads", "").isdigit() else 0
        google_ads = int(adv.get("google_ads") or 0) if adv.get("google_ads", "").isdigit() else 0
        linkedin_ads = int(adv.get("linkedin_ads") or 0) if adv.get("linkedin_ads", "").isdigit() else 0
        total_ads = int(adv.get("total_ads") or (meta_ads + google_ads + linkedin_ads))

        # Audit data (may be missing if 409 hasn't completed yet).
        audit = audits.get(domain)
        if audit:
            audit_url = audit.get("audit_url", "")
            score = float(audit.get("score")) if audit.get("score", "").replace(".", "").isdigit() else None
            hero_dimension = audit.get("hero_dimension", "")
            hero_diagnosis = audit.get("hero_diagnosis", "")
            audit_date = date.today().isoformat()
        else:
            audit_url = ""
            score = None
            hero_dimension = ""
            hero_diagnosis = ""
            audit_date = ""

        # One-liner: only meaningful when we have audit data.
        if hero_dimension:
            one_liner = get_one_liner(hero_dimension, hero_diagnosis)
        else:
            one_liner = ""

        # DM templates.
        intro_first = first_name if first_name else "there"
        intro_dm = INTRO_DM_TEMPLATE.format(first_name=intro_first, company=company)

        if audit_url and one_liner:
            followup_first = first_name if first_name else "there"
            followup_dm = FOLLOWUP_DM_TEMPLATE.format(
                first_name=followup_first,
                company=company,
                one_liner=one_liner,
                audit_url=audit_url,
            )
        else:
            followup_dm = ""  # No audit yet - leave blank, fill on round 2.

        record = {
            "Full Name": full_name,
            "First Name": first_name,
            "Title": title,
            "Email": email if "@" in email else "",
            "Company": company,
            "Domain": f"https://{domain}" if not domain.startswith("http") else domain,
            "LinkedIn URL": linkedin_url,
            "Industry": industry,
            "Total Ads": total_ads,
            "Meta Ads": meta_ads,
            "Google Ads": google_ads,
            "LinkedIn Ads": linkedin_ads,
            "Score": score,
            "Audit URL": audit_url,
            "Hero Dimension": hero_dimension if hero_dimension else None,
            "Hero One-Liner": one_liner,
            "Introduction DM": intro_dm,
            "Follow-up DM": followup_dm,
            "Outreach Stage": "Not Sent",
            "Audit Date": audit_date if audit_date else None,
        }
        # Strip None values and empty strings on optional fields to keep Airtable clean.
        cleaned = {k: v for k, v in record.items() if v not in (None, "")}
        records.append(cleaned)

    with open(OUT_JSONL, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    print(f"Wrote {len(records)} records to {OUT_JSONL}")
    print(f"  with audit_url: {sum(1 for r in records if r.get('Audit URL'))}")
    print(f"  without audit_url (will fill after 409 completes): {sum(1 for r in records if not r.get('Audit URL'))}")
    print(f"  with first name: {sum(1 for r in records if r.get('First Name'))}")
    print(f"  without first name (DM falls back to 'Hey there,'): {sum(1 for r in records if not r.get('First Name'))}")
    print(f"  with linkedin url: {sum(1 for r in records if r.get('LinkedIn URL'))}")


if __name__ == "__main__":
    main()
