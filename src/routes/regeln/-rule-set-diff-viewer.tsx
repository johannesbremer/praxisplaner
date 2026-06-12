import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import React from "react";

interface RuleSetDiffViewerRow {
  after: string;
  before: string;
  path: string;
}

interface RuleSetDiffViewerSection {
  title: string;
}

function buildStructuredValueDiff(
  after: string,
  before: string,
  path: string,
  sectionTitle: string,
) {
  const fileName = `${sectionTitle}/${path}`;
  try {
    return parseDiffFromFile(
      {
        contents: toDiffFileContents(before),
        name: fileName,
      },
      {
        contents: toDiffFileContents(after),
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
  const diff = React.useMemo(
    () =>
      buildStructuredValueDiff(row.after, row.before, row.path, section.title),
    [row.after, row.before, row.path, section.title],
  );

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
