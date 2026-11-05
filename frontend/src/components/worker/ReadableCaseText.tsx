import { caseTextBlocks } from '../../lib/casePresentation';

/** One renderer for retrieved cases and user-registered case history. */
export function ReadableCaseText({ value }: { value: unknown }) {
  return <ul className="space-y-1.5">{caseTextBlocks(value).map((block, index) => <li key={index}>
    {block.label && <b className="mr-1 font-medium">{block.label}:</b>}<span className="whitespace-pre-wrap">{block.text}</span>
  </li>)}</ul>;
}
