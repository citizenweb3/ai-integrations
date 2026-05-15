import type { FormEvent, KeyboardEvent } from 'react';

type ChatComposerProps = {
  input: string;
  isBusy: boolean;
  onInputChange: (value: string) => void;
  onSubmitText: (value: string) => void;
};

const ChatComposer = ({ input, isBusy, onInputChange, onSubmitText }: ChatComposerProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmitText(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();
    onSubmitText(input);
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-white/10 p-4">
      <div className="mx-auto flex w-full max-w-4xl gap-3 rounded-[10px] border border-white/10 bg-[#111111] p-2">
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Ask a Logos onboarding question..."
          className="min-h-12 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/35"
        />
        <button
          type="submit"
          disabled={!input.trim() || isBusy}
          className="min-w-24 rounded-[8px] bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#2FFBF7] disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/35"
        >
          Send
        </button>
      </div>
    </form>
  );
};

export default ChatComposer;
