import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type MarkdownContentProps = {
  markdownText: string
  variant: 'chat' | 'canvas'
}

export const MarkdownContent = memo(function MarkdownContent({
  markdownText,
  variant,
}: MarkdownContentProps): JSX.Element | null {
  if (!String(markdownText || '').trim()) return null

  return (
    <div className={`tc-ai-chat-markdown tc-markdown tc-markdown--${variant}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node: _node, ...props }) => <p className="tc-ai-chat-markdown__paragraph" {...props} />,
          a: ({ node: _node, ...props }) => <a className="tc-ai-chat-markdown__link" target="_blank" rel="noreferrer" {...props} />,
          ul: ({ node: _node, ...props }) => <ul className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--unordered" {...props} />,
          ol: ({ node: _node, ...props }) => <ol className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--ordered" {...props} />,
          li: ({ node: _node, ...props }) => <li className="tc-ai-chat-markdown__list-item" {...props} />,
          blockquote: ({ node: _node, ...props }) => <blockquote className="tc-ai-chat-markdown__blockquote" {...props} />,
          img: ({ node: _node, ...props }) => <img className="tc-ai-chat-markdown__image" loading="lazy" referrerPolicy="no-referrer" {...props} />,
          h1: ({ node: _node, ...props }) => <h1 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h1" {...props} />,
          h2: ({ node: _node, ...props }) => <h2 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h2" {...props} />,
          h3: ({ node: _node, ...props }) => <h3 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h3" {...props} />,
          h4: ({ node: _node, ...props }) => <h4 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h4" {...props} />,
          h5: ({ node: _node, ...props }) => <h5 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h5" {...props} />,
          h6: ({ node: _node, ...props }) => <h6 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h6" {...props} />,
          code: ({ node: _node, className, children, ...props }) => {
            const isInline = !String(className || '').includes('language-')
            if (isInline) {
              return <code className="tc-ai-chat-markdown__code tc-ai-chat-markdown__code--inline" {...props}>{children}</code>
            }
            return <code className={`tc-ai-chat-markdown__code tc-ai-chat-markdown__code--block ${className || ''}`.trim()} {...props}>{children}</code>
          },
          pre: ({ node: _node, ...props }) => <pre className="tc-ai-chat-markdown__pre" {...props} />,
          hr: ({ node: _node, ...props }) => <hr className="tc-ai-chat-markdown__divider" {...props} />,
          table: ({ node: _node, ...props }) => (
            <div className="tc-ai-chat-markdown__table-scroll">
              <table className="tc-ai-chat-markdown__table" {...props} />
            </div>
          ),
          thead: ({ node: _node, ...props }) => <thead className="tc-ai-chat-markdown__table-head" {...props} />,
          tbody: ({ node: _node, ...props }) => <tbody className="tc-ai-chat-markdown__table-body" {...props} />,
          tr: ({ node: _node, ...props }) => <tr className="tc-ai-chat-markdown__table-row" {...props} />,
          th: ({ node: _node, ...props }) => <th className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--head" {...props} />,
          td: ({ node: _node, ...props }) => <td className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--body" {...props} />,
        }}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  )
})
