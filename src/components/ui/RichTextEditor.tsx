import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Bold, Italic, List, ListOrdered, Heading2 } from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}

function exec(command: string, value?: string): void {
  document.execCommand(command, false, value);
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = '140px' }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const handleInput = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? '';
    onChange(html === '<br>' ? '' : html);
  }, [onChange]);

  const toolbarBtn = (label: string, icon: ReactNode, action: () => void) => (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => {
        e.preventDefault();
        action();
        editorRef.current?.focus();
        handleInput();
      }}
      className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
    >
      {icon}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" dir="rtl">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-2 py-1">
        {toolbarBtn('عريض', <Bold className="h-3.5 w-3.5" />, () => exec('bold'))}
        {toolbarBtn('مائل', <Italic className="h-3.5 w-3.5" />, () => exec('italic'))}
        {toolbarBtn('عنوان', <Heading2 className="h-3.5 w-3.5" />, () => exec('formatBlock', 'h3'))}
        {toolbarBtn('قائمة', <List className="h-3.5 w-3.5" />, () => exec('insertUnorderedList'))}
        {toolbarBtn('قائمة مرقمة', <ListOrdered className="h-3.5 w-3.5" />, () => exec('insertOrderedList'))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="rich-editor min-w-0 px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
        style={{ minHeight }}
      />
    </div>
  );
}

export function RichTextContent({ html, className = '' }: { html?: string; className?: string }) {
  if (!html?.trim()) return null;
  return (
    <div
      className={`prose prose-sm max-w-none text-slate-700 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pr-4 ${className}`}
      dir="rtl"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
