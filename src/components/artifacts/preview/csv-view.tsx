// First N rows of a CSV rendered as a table (PLAN §2). Uses a minimal split — good
// enough for a preview; the download link serves the authoritative file. Values
// render as React text nodes, so they are inert.
const MAX_ROWS = 50;

function parseCsv(source: string): string[][] {
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_ROWS + 1)
    .map((line) => line.split(","));
}

export function CsvView({ source }: { source: string }) {
  const rows = parseCsv(source);
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Empty file.</p>;

  const [header, ...body] = rows;
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {header?.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static CSV preview, columns never reorder.
              <th key={i} className="border-b px-3 py-2 font-medium whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static CSV preview, rows never reorder.
            <tr key={r} className="border-b last:border-0">
              {row.map((cell, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static CSV preview, cells never reorder.
                <td key={c} className="px-3 py-1.5 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
