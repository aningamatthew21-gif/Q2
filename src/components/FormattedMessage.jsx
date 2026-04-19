import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Allow a minimal, safe set of tags and attributes; add <u>
const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'u'],
    attributes: {
        ...(defaultSchema.attributes || {}),
        a: ['href', 'title', 'target', 'rel']
    }
};

const ENABLE_CHAT_FORMATTING = true;

export default function FormattedMessage({ content }) {
    if (!ENABLE_CHAT_FORMATTING) {
        return <>{content}</>;
    }
    try {
        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeRaw], [rehypeSanitize, sanitizeSchema]]}
                components={{
                    a: ({node, ...props}) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" />
                    )
                }}
            >
                {content}
            </ReactMarkdown>
        );
    } catch (e) {
        return <>{content}</>;
    }
}


