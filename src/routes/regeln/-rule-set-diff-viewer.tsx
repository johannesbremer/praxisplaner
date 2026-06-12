import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

interface RuleSetDiffViewerRow {
  after: string;
  before: string;
  path: string;
}

interface RuleSetDiffViewerSection {
  title: string;
}

function buildStructuredValueDiff(
  row: RuleSetDiffViewerRow,
  sectionTitle: string,
) {
  const fileName = `${sectionTitle}/${row.path}`;
  try {
    return parseDiffFromFile(
      {
        contents: toDiffFileContents(row.before),
        name: fileName,
      },
      {
        contents: toDiffFileContents(row.after),
        name: fileName,
      },
      { context: Number.MAX_SAFE_INTEGER },
    );
  } catch {
    return null;
  }
}

function StructuredValueDiffView({
  row,
  section,
}: {
  row: RuleSetDiffViewerRow;
  section: RuleSetDiffViewerSection;
}) {
  const diff = buildStructuredValueDiff(row, section.title);

  if (!diff) {
    return (
      <div className="min-w-0 overflow-hidden bg-background text-xs">
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">
          {[row.before, row.after].filter(Boolean).join("\n")}
        </pre>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden bg-background text-xs">
      <FileDiff
        disableWorkerPool
        fileDiff={diff}
        options={{
          diffStyle: "unified",
          disableLineNumbers: true,
          overflow: "wrap",
        }}
      />
    </div>
  );
}

function toDiffFileContents(value: string) {
  return value.trim() ? `${value}\n` : "";
}

export { StructuredValueDiffView };
