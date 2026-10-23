// Only ever pass HTML that came from the API's renderMarkdown() (server-sanitised allow-list).
// Never pass user-typed strings here.
export default function RichHtml({ html }) {
  return <div className="rich" dangerouslySetInnerHTML={{ __html: html }} />;
}
