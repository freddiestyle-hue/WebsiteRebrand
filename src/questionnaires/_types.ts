export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'url'
  | 'email'
  | 'two_field'
  | 'five_field'
  | 'single_select_letter'
  | 'multi_select_letter';

export type QuestionField = {
  id: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
};

export type QuestionOption = {
  key: string;
  label: string;
};

export type QuestionConfig = {
  id: string;
  type: QuestionType;
  text: string;
  emphasis?: string[];
  helper?: string;
  placeholder?: string;
  optional?: boolean;
  fields?: QuestionField[];
  options?: QuestionOption[];
  validate?: 'url' | 'email';
};

export type ProspectConfig = {
  slug: string;
  prospect_name: string;
  top_meta: string;
  welcome: {
    headline: string;
    body: string;
    cta_label: string;
    logo?: {
      src: string;
      alt: string;
    };
  };
  thank_you: {
    headline: string;
    body: string;
  };
  email_to: string;
  questions: QuestionConfig[];
};

export type AnswerValue = string | string[] | Record<string, string>;

export type QuestionnaireAnswers = Record<string, AnswerValue>;
