import type { Reliability } from './memo-schema';

export interface ConfidenceCopy {
  label: string;
  detail: string;
  assertive: boolean;
}

export function confidenceCopy(reliability?: Reliability): ConfidenceCopy {
  switch (reliability) {
    case 'verified':
      return {
        label: 'Verified',
        detail: 'Public evidence supports this finding.',
        assertive: true,
      };
    case 'verified-na':
      return {
        label: 'Not applicable',
        detail: 'The check is verified, but it does not apply to this channel mix.',
        assertive: false,
      };
    case 'inferred':
      return {
        label: 'Directional read',
        detail: 'This is a pattern read from public signals, not a measurement.',
        assertive: false,
      };
    case 'soft-absence':
    default:
      return {
        label: 'Could not confirm',
        detail: 'The scan did not confirm this. Treat it as a question for the team.',
        assertive: false,
      };
  }
}

export function findingLead(reliability?: Reliability): string {
  return confidenceCopy(reliability).assertive ? 'Finding' : 'Question';
}
