import React from "react";
import { Action, ActionPanel, List } from "@raycast/api";
import { MIN_RELEVANCE } from "../jev";
import type { SearchDiagnostic } from "../utils";

type Props = { query: string; diagnostics: SearchDiagnostic[] };

export function SearchDiagnostics({ query, diagnostics }: Props) {
  const describe = ({ name, score }: SearchDiagnostic) =>
    `${name}: ${score === null ? "not scored" : `${score} (${score >= MIN_RELEVANCE ? "shown" : "below cutoff"})`}`;
  const report = [
    `Query: ${query}`,
    `Shortlisted: ${diagnostics.length}; relevance cutoff: ${MIN_RELEVANCE}`,
    ...diagnostics.map(describe),
  ].join("\n");
  const actions = (
    <ActionPanel>
      <Action.CopyToClipboard title="Copy Diagnostics" content={report} />
    </ActionPanel>
  );
  return (
    <List
      navigationTitle="Search Diagnostics"
      searchBarPlaceholder="Filter shortlisted names"
    >
      {diagnostics.length === 0 ? (
        <List.EmptyView
          title="No candidates shortlisted"
          description="No emoji names or aliases matched the search."
          actions={actions}
        />
      ) : (
        <List.Section
          title={`${diagnostics.length} shortlisted · cutoff ${MIN_RELEVANCE}`}
        >
          {diagnostics.map((diagnostic) => (
            <List.Item
              key={diagnostic.name}
              title={diagnostic.name}
              subtitle={
                diagnostic.score === null
                  ? "Not scored"
                  : diagnostic.score >= MIN_RELEVANCE
                    ? "Shown"
                    : "Below cutoff"
              }
              accessories={
                diagnostic.score === null
                  ? []
                  : [{ text: String(diagnostic.score) }]
              }
              actions={actions}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
