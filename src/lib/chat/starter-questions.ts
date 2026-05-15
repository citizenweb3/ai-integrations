export const LOGOS_STARTER_QUESTIONS = [
  'How do I run a Logos node?',
  'What are Logos Improvement Proposals?',
  'How does Waku fit into Logos messaging?',
  'What is Cryptarchia consensus?',
  'How does the Logos Execution Zone work?',
  'How do I build a dApp on Logos?',
  'What are the main Logos stack modules?',
  'How does Logos handle privacy?',
  'Where can I find Logos node setup docs?',
  'What is the difference between Logos Blockchain and Logos Messaging?',
  'How do I contribute to Logos documentation?',
  'What source should I read first as a new Logos builder?',
  'How does Logos storage fit into the stack?',
  'What is Logos Basecamp?',
  'How do LIPs move from draft to stable?',
  'Which GitHub repositories are most useful for onboarding?',
];

export const STARTER_QUESTION_COUNT = 6;

export const selectRandomStarterQuestions = (questions: string[], count: number): string[] => {
  return [...questions]
    .map((question) => ({ question, rank: Math.random() }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, count)
    .map(({ question }) => question);
};

let starterQuestionSnapshot: string[] | null = null;
const starterQuestionServerSnapshot = LOGOS_STARTER_QUESTIONS.slice(0, STARTER_QUESTION_COUNT);

export const getStarterQuestionsServerSnapshot = (): string[] => {
  return starterQuestionServerSnapshot;
};

export const getStarterQuestionsSnapshot = (): string[] => {
  starterQuestionSnapshot ??= selectRandomStarterQuestions(LOGOS_STARTER_QUESTIONS, STARTER_QUESTION_COUNT);
  return starterQuestionSnapshot;
};

export const subscribeToStarterQuestions = (onStoreChange: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const timer = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timer);
};
