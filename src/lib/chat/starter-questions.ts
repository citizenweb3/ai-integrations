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
  'What hardware do I need to run a validator?',
  'How is staking handled in Logos?',
  'What programming languages are used across the Logos stack?',
  'How does Logos compare to Ethereum?',
  'What is the role of Nomos in the Logos stack?',
  'How does Waku Relay protocol work?',
  'How are messages encrypted in Waku?',
  'What is the Logos Network Layer?',
  'How do I join the Logos testnet?',
  'How do I report a bug in a Logos repository?',
  'What is the Logos roadmap?',
  'How does proof-of-stake selection work in Cryptarchia?',
  'What is the Logos vision for digital sovereignty?',
  'How do I sync a Logos archive node?',
  'What is mix networking and how does Logos use it?',
  'How does Logos achieve censorship resistance?',
  'What APIs does a Logos node expose?',
  'How do I monitor a Logos node?',
  'How is data storage decentralized in Logos?',
  'What is the difference between Nomos and Codex in Logos?',
  'How are LIPs reviewed and approved?',
  'How does Logos governance work?',
  'What tooling exists for Logos developers?',
  'How do I write a smart contract for the Logos Execution Zone?',
  'What is the role of zero-knowledge proofs in Logos?',
  'How does Logos protect against Sybil attacks?',
  'What are the bootstrap nodes for Logos?',
  'How do I migrate from an Ethereum dApp to Logos?',
  'What logging and metrics does a Logos node provide?',
  'How does the consensus finality work in Cryptarchia?',
  'What client implementations of Logos exist?',
  'Where can I follow Logos development updates?',
  'What is the recommended setup for testing Logos locally?',
  'How does Logos handle network upgrades?',
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
