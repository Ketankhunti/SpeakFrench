"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

interface ReviewMarkdownProps {
  content: string;
  className?: string;
}

export default function ReviewMarkdown({ content, className = "" }: ReviewMarkdownProps) {
  return (
    <div className={`text-slate-300 ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-semibold text-white mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold text-white mb-2 mt-4">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-white mb-2 mt-3">{children}</h3>,
          p: ({ children }) => <p className="text-sm leading-relaxed mb-3">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 mb-3">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 mb-3">{children}</ol>,
          li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
