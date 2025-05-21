import React from "react";
import { ActionPanel, Action, List } from "@raycast/api";
import { emojiItem } from "../utils";

type AliasListProps = {
  emoji: emojiItem;
};

export const AliasList = ({ emoji }: AliasListProps) => {
  const name = emoji.keywords[0];
  const aliases = emoji.keywords.slice(1);

  return (
    <List>
      <List.Section title="Emoji">
        <List.Item
          title={name}
          actions={
            <ActionPanel>
              <Action.Paste title="Paste emoji" content={`:${name}:`} />
              <Action.CopyToClipboard
                title="Copy name to clipboard"
                content={`:${name}:`}
              />
            </ActionPanel>
          }
        />
      </List.Section>
      {aliases.length > 0 && (
        <List.Section title="Aliases">
          {aliases.map((alias) => (
            <List.Item
              key={alias}
              title={alias}
              actions={
                <ActionPanel>
                  <Action.Paste title="Paste emoji" content={`:${alias}:`} />
                  <Action.CopyToClipboard
                    title="Copy name to clipboard"
                    content={`:${alias}:`}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
};
