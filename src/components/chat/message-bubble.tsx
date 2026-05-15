import { textForMessage } from '@/lib/chat/messages';

import MarkdownMessage from './markdown-message';
import SourceChips from './source-chips';
import type { LogosChatMessage } from './types';

type MessageBubbleProps = {
  message: LogosChatMessage;
};

const MessageBubble = ({ message }: MessageBubbleProps) => {
  const text = textForMessage(message);
  const sources = message.metadata?.sources ?? [];
  const isUser = message.role === 'user';

  if (!text && sources.length === 0) return null;

  return (
    <article className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[82%] rounded-[10px] border border-[#2FFBF7]/25 bg-[#2FFBF7]/10 px-4 py-3 text-sm text-white'
            : 'max-w-[88%] rounded-[10px] border border-white/10 bg-[#1A1A1B]/80 px-4 py-3 text-sm text-white/90'
        }
      >
        {text && (isUser ? <div className="whitespace-pre-wrap leading-6">{text}</div> : <MarkdownMessage text={text} />)}
        {!isUser && <SourceChips sources={sources} text={text} />}
      </div>
    </article>
  );
};

export default MessageBubble;
