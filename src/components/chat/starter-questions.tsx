type StarterQuestionsProps = {
  questions: string[];
  isBusy: boolean;
  onSelect: (question: string) => void;
};

const StarterQuestions = ({ questions, isBusy, onSelect }: StarterQuestionsProps) => {
  return (
    <div className="mx-auto mt-6 grid w-full max-w-3xl gap-2 md:grid-cols-2 lg:grid-cols-3">
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSelect(question)}
          disabled={isBusy}
          className="rounded-[8px] border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs leading-4 text-white/75 transition hover:border-[#2FFBF7]/55 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {question}
        </button>
      ))}
    </div>
  );
};

export default StarterQuestions;
