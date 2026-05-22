import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnswerValue,
  ProspectConfig,
  QuestionConfig,
  QuestionnaireAnswers,
} from './_types';
import './_engine.css';

type Screen = 'welcome' | 'questions' | 'done';

type QuestionnaireEngineProps = {
  config: ProspectConfig;
};

const slideTransition = {
  duration: 0.46,
  ease: [0.2, 0.6, 0.2, 1],
} as const;

const focusAfterTransitionMs = 560;

export default function QuestionnaireEngine({ config }: QuestionnaireEngineProps) {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = config.questions.length;
  const current = config.questions[index];

  const progress = useMemo(() => {
    if (screen === 'done') return 1;
    if (screen === 'welcome') return 0;
    return Math.min(index / total, 1);
  }, [index, screen, total]);

  const setAnswer = useCallback((questionId: string, value: AnswerValue) => {
    setAnswers((existing) => ({ ...existing, [questionId]: value }));
    setError(null);
  }, []);

  const goBack = useCallback(() => {
    if (isSubmitting) return;
    setError(null);
    blurActiveControl();

    if (screen === 'questions' && index > 0) {
      setDirection(-1);
      setIndex((currentIndex) => currentIndex - 1);
      return;
    }

    if (screen === 'questions' && index === 0) {
      setDirection(-1);
      setScreen('welcome');
    }
  }, [index, isSubmitting, screen]);

  const start = useCallback(() => {
    setError(null);
    blurActiveControl();
    setDirection(1);
    setScreen('questions');
  }, []);

  const advance = useCallback(
    async (override?: { questionId: string; value: AnswerValue }) => {
      if (isSubmitting) return;

      if (screen === 'welcome') {
        start();
        return;
      }

      if (screen !== 'questions') return;

      const nextAnswers = override
        ? { ...answers, [override.questionId]: override.value }
        : answers;

      const validationError = validateQuestion(current, nextAnswers[current.id]);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      blurActiveControl();
      setDirection(1);

      if (index + 1 < total) {
        if (override) setAnswers(nextAnswers);
        setIndex((currentIndex) => currentIndex + 1);
        return;
      }

      setIsSubmitting(true);

      try {
        const response = await fetch('/api/qualify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: config.slug,
            answers: nextAnswers,
            submitted_at: new Date().toISOString(),
          }),
        });

        const result = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(result.error || 'Could not send this yet. Try again.');
        }

        if (override) setAnswers(nextAnswers);
        setScreen('done');
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'Could not send this yet. Try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [answers, config.slug, current, index, isSubmitting, screen, start, total]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (screen === 'done') return;

      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        goBack();
        return;
      }

      if (event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'TEXTAREA' && event.shiftKey) return;
        if (target?.closest('a[href]')) return;
        event.preventDefault();
        void advance();
        return;
      }

      if (screen === 'questions' && (current.type === 'single_select_letter' || current.type === 'multi_select_letter')) {
        const key = event.key.toUpperCase();
        const option = current.options?.find((candidate) => candidate.key.toUpperCase() === key);
        if (!option) return;

        event.preventDefault();
        const value = option.key;

        if (current.type === 'multi_select_letter') {
          const existing = answers[current.id];
          const nextValue = toggleOption(Array.isArray(existing) ? existing : [], value);
          setAnswer(current.id, nextValue);
          return;
        }

        setAnswer(current.id, value);
        window.setTimeout(() => {
          void advance({ questionId: current.id, value });
        }, 300);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advance, answers, current, goBack, screen, setAnswer]);

  return (
    <div className="questionnaire-app">
      <div className="progress" aria-hidden="true">
        <div className="bar" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="top-bar">
        <a className="wordmark" href="/" aria-label="Rivett, home">
          rivett<span className="dot" aria-hidden="true" />
        </a>
        <div className="top-meta">{renderTopMeta(config.top_meta)}</div>
      </div>

      <section className="stage" aria-live="polite">
        <div className="scene">
          <AnimatePresence mode="wait" custom={direction}>
            {screen === 'welcome' && (
              <MotionPanel key="welcome" direction={direction}>
                <WelcomeScreen config={config} onStart={start} />
              </MotionPanel>
            )}

            {screen === 'questions' && (
              <MotionPanel key={current.id} direction={direction}>
                <QuestionScreen
                  answer={answers[current.id]}
                  config={config}
                  error={error}
                  index={index}
                  isSubmitting={isSubmitting}
                  onAdvance={advance}
                  onChange={(value) => setAnswer(current.id, value)}
                  question={current}
                />
              </MotionPanel>
            )}

            {screen === 'done' && (
              <MotionPanel key="done" direction={direction}>
                <ThankYouScreen config={config} />
              </MotionPanel>
            )}
          </AnimatePresence>
        </div>
      </section>

      {screen === 'questions' && (
        <>
          <div className="bottom-nav">
            <button type="button" onClick={goBack} disabled={index === 0 || isSubmitting}>
              <span aria-hidden="true">←</span> Back
            </button>
          </div>
          <div className="bottom-right">
            <span>{`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}</span>
          </div>
        </>
      )}
    </div>
  );
}

function MotionPanel({
  children,
  direction,
}: {
  children: React.ReactNode;
  direction: number;
}) {
  return (
    <motion.div
      className="panel"
      custom={direction}
      initial={{ y: direction > 0 ? 48 : -48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: direction > 0 ? -48 : 48, opacity: 0 }}
      transition={slideTransition}
    >
      {children}
    </motion.div>
  );
}

function WelcomeScreen({ config, onStart }: { config: ProspectConfig; onStart: () => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => buttonRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="end welcome">
      {config.welcome.logo && (
        <img
          alt={config.welcome.logo.alt}
          className="prospect-logo"
          src={config.welcome.logo.src}
        />
      )}
      <span className="stamp-row">Direct link</span>
      <h1>{config.welcome.headline}</h1>
      <div className="lede">
        {splitParagraphs(config.welcome.body).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="controls">
        <button ref={buttonRef} className="ok-btn" type="button" onClick={onStart}>
          {config.welcome.cta_label} <span aria-hidden="true">↵</span>
        </button>
        <span className="hint">
          press <kbd>Enter</kbd>
        </span>
      </div>
    </div>
  );
}

function QuestionScreen({
  answer,
  config,
  error,
  index,
  isSubmitting,
  onAdvance,
  onChange,
  question,
}: {
  answer: AnswerValue | undefined;
  config: ProspectConfig;
  error: string | null;
  index: number;
  isSubmitting: boolean;
  onAdvance: (override?: { questionId: string; value: AnswerValue }) => void | Promise<void>;
  onChange: (value: AnswerValue) => void;
  question: QuestionConfig;
}) {
  const isLast = index + 1 === config.questions.length;

  return (
    <>
      <div className="qnum">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <span className="arrow" aria-hidden="true">→</span>
        <span style={{ color: 'var(--ink-faint)' }}>{`of ${String(config.questions.length).padStart(2, '0')}`}</span>
      </div>
      <h2 className="qtext">{renderQuestionText(question)}</h2>
      {question.helper && <p className="helper">{question.helper}</p>}

      <QuestionField
        onAdvance={onAdvance}
        onChange={onChange}
        question={question}
        value={answer}
      />

      {error && <div className="err">{error}</div>}

      <div className="controls">
        <button
          className="ok-btn"
          type="button"
          disabled={isSubmitting}
          onClick={() => void onAdvance()}
        >
          {isSubmitting ? 'Sending' : isLast ? 'Submit' : 'OK'} <span aria-hidden="true">↵</span>
        </button>
        <span className="hint">
          {question.type === 'multi_select_letter' ? (
            <>
              choose any, then press <kbd>Enter</kbd>
            </>
          ) : (
            <>
              press <kbd>Enter</kbd> {isLast ? 'to send' : 'to continue'}
            </>
          )}
        </span>
      </div>
    </>
  );
}

function QuestionField({
  onAdvance,
  onChange,
  question,
  value,
}: {
  onAdvance: (override?: { questionId: string; value: AnswerValue }) => void | Promise<void>;
  onChange: (value: AnswerValue) => void;
  question: QuestionConfig;
  value: AnswerValue | undefined;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isCoarsePointer()) return;

      focusWithoutScroll(
        wrapperRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
          'input, textarea, button'
        )
      );
    }, focusAfterTransitionMs);

    return () => window.clearTimeout(timer);
  }, [question.id]);

  if (question.type === 'short_text' || question.type === 'url' || question.type === 'email') {
    return (
      <div ref={wrapperRef} className="field-line">
        <input
          autoComplete="off"
          inputMode={question.type === 'email' ? 'email' : question.type === 'url' ? 'url' : 'text'}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
          spellCheck={false}
          type={question.type === 'email' ? 'email' : 'text'}
          value={typeof value === 'string' ? value : ''}
        />
      </div>
    );
  }

  if (question.type === 'long_text') {
    return (
      <div ref={wrapperRef} className="field-multi">
        <AutosizeTextarea
          onChange={onChange}
          placeholder={question.placeholder}
          value={typeof value === 'string' ? value : ''}
        />
      </div>
    );
  }

  if (question.type === 'two_field' || question.type === 'five_field') {
    const objectValue: Record<string, string> =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fields = question.fields ?? [];
    const className = question.type === 'two_field' ? 'two-col' : 'stack-grid';

    return (
      <div ref={wrapperRef} className={className}>
        {fields.map((field) => (
          <div key={field.id} className="stack-row">
            <label>{field.label}</label>
            <div className="field-line" style={question.type === 'two_field' ? { padding: '10px 0', fontSize: 22 } : undefined}>
              <input
                autoComplete="off"
                onChange={(event) =>
                  onChange({
                    ...objectValue,
                    [field.id]: event.target.value,
                  })
                }
                placeholder={field.placeholder ?? '-'}
                spellCheck={false}
                type="text"
                value={objectValue[field.id] ?? ''}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (question.type === 'single_select_letter' || question.type === 'multi_select_letter') {
    const isMulti = question.type === 'multi_select_letter';
    const selected = typeof value === 'string' ? value : '';
    const selectedValues = Array.isArray(value) ? value : [];

    return (
      <div ref={wrapperRef} className="options" role={isMulti ? 'group' : 'radiogroup'}>
        {(question.options ?? []).map((option) => (
          <button
            aria-checked={isMulti ? selectedValues.includes(option.key) : selected === option.key}
            className={`opt ${isMulti ? selectedValues.includes(option.key) ? 'active' : '' : selected === option.key ? 'active' : ''}`}
            key={option.key}
            onClick={() => {
              if (isMulti) {
                onChange(toggleOption(selectedValues, option.key));
                return;
              }

              onChange(option.key);
              window.setTimeout(() => {
                void onAdvance({ questionId: question.id, value: option.key });
              }, 300);
            }}
            role={isMulti ? 'checkbox' : 'radio'}
            type="button"
          >
            <span className="key">{option.key}</span>
            <span className="label">{option.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return null;
}

function AutosizeTextarea({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 260)}px`;
  }, [value]);

  return (
    <textarea
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      ref={textareaRef}
      rows={1}
      spellCheck={false}
      value={value}
    />
  );
}

function ThankYouScreen({ config }: { config: ProspectConfig }) {
  return (
    <div className="end">
      <span className="stamp-row">Received</span>
      <h1>{config.thank_you.headline}</h1>
      <div className="lede">
        {splitParagraphs(config.thank_you.body).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}

function validateQuestion(question: QuestionConfig, value: AnswerValue | undefined) {
  if (question.optional) return null;

  if (question.type === 'two_field') {
    const objectValue: Record<string, string> =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const missing = (question.fields ?? []).some((field) => !field.optional && !objectValue[field.id]?.trim());
    return missing ? 'Both fields, please.' : null;
  }

  if (question.type === 'five_field') return null;

  if (question.type === 'single_select_letter') {
    return typeof value === 'string' && value ? null : 'Pick one.';
  }

  if (question.type === 'multi_select_letter') {
    return Array.isArray(value) && value.length > 0 ? null : 'Pick at least one.';
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 'A short answer is fine.';
  }

  if (question.validate === 'url') {
    return /\.[a-z]{2,}/i.test(value.trim()) ? null : 'Looks incomplete. Need a real URL.';
  }

  if (question.validate === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : 'Looks incomplete. Need a real email.';
  }

  return null;
}

function renderQuestionText(question: QuestionConfig) {
  const emphasis = question.emphasis?.filter(Boolean) ?? [];
  if (emphasis.length === 0) return question.text;

  let remaining = question.text;
  const nodes: ReactNode[] = [];

  emphasis.forEach((phrase, phraseIndex) => {
    const matchIndex = remaining.indexOf(phrase);
    if (matchIndex === -1) return;

    if (matchIndex > 0) {
      nodes.push(remaining.slice(0, matchIndex));
    }

    nodes.push(
      <span className="ital" key={`${phrase}-${phraseIndex}`}>
        {phrase}
      </span>
    );

    remaining = remaining.slice(matchIndex + phrase.length);
  });

  if (remaining) nodes.push(remaining);
  return nodes.length > 0 ? nodes : question.text;
}

function renderTopMeta(topMeta: string) {
  const [first, ...rest] = topMeta.split('·').map((part) => part.trim());
  if (rest.length === 0) return <span className="gd">{topMeta}</span>;

  return (
    <>
      <span className="gd">{first}</span> · {rest.join(' · ')}
    </>
  );
}

function splitParagraphs(text: string) {
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function toggleOption(existing: string[], key: string) {
  return existing.includes(key)
    ? existing.filter((candidate) => candidate !== key)
    : [...existing, key];
}

function blurActiveControl() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(active.tagName)) return;
  active.blur();
}

function focusWithoutScroll(element: HTMLElement | null | undefined) {
  if (!element) return;

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function isCoarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
