import React, { useState, useEffect } from "react";
import {
  Grid,
  ActionPanel,
  Action,
  showToast,
  Toast,
  getPreferenceValues,
  Clipboard,
  Icon,
} from "@raycast/api";
import fs from "fs";
import { emojiItem, readEmojiDirectory, clearEmojiCache } from "./utils";
import { runGitPull } from "./utils/runGitPull";
import { AliasList } from "./components/AliasList";

export default function Command() {
  const { emojiDirectory, githubToken, ignoreList } =
    getPreferenceValues<Preferences.Index>();
  const [emojis, setEmojis] = useState<emojiItem[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submittedSearchText, setSubmittedSearchText] = useState("");
  const [searchCounter, setSearchCounter] = useState(0);

  useEffect(() => {
    if (!emojiDirectory || !fs.existsSync(emojiDirectory)) {
      showToast(
        Toast.Style.Failure,
        "Emoji directory not found",
        "Set a valid emoji directory in extension preferences.",
      );
      return;
    }
    if (!githubToken) {
      showToast(
        Toast.Style.Failure,
        "GitHub token not set",
        "Add a GitHub PAT with models:read scope in extension preferences.",
      );
      return;
    }
  }, [emojiDirectory, githubToken]);

  useEffect(() => {
    if (submittedSearchText.trim() === "") {
      setEmojis([]);
      return;
    }

    setIsLoading(true);
    const parsedIgnoreList = ignoreList
      ? ignoreList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    readEmojiDirectory(emojiDirectory, submittedSearchText, parsedIgnoreList)
      .then((emojis) => {
        setEmojis(emojis);
        if (emojis.length === 0) {
          showToast(Toast.Style.Animated, "No emojis found for your query.");
        }
      })
      .catch((err) => {
        showToast(Toast.Style.Failure, "Could not load emojis", err.message);
        setEmojis([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [emojiDirectory, submittedSearchText, searchCounter]);

  const handleClearSearch = () => {
    setSearchText("");
    setSubmittedSearchText("");
    setEmojis([]);
  };

  const updateEmojiRepo = async () => {
    showToast({
      title: "Updating emoji repository...",
      style: Toast.Style.Animated,
    });

    const { exitCode, stderr } = await runGitPull(emojiDirectory);
    if (exitCode !== 0) {
      showToast({
        title: "Error updating emoji repository",
        message: stderr,
        style: Toast.Style.Failure,
      });
      return;
    }

    clearEmojiCache();
    showToast({
      title: "Emoji repository updated!",
      style: Toast.Style.Success,
    });
  };

  const handleSubmitSearch = () => {
    const trimmedSearchText = searchText.trim();

    if (trimmedSearchText === "") {
      setSubmittedSearchText("");
      setEmojis([]);
      return;
    }

    setSubmittedSearchText(trimmedSearchText);
    setSearchCounter((c) => c + 1);
  };

  const UpdateRepoAction = () => (
    <Action
      title="Update Emoji Repo"
      icon={Icon.RotateClockwise}
      shortcut={{ modifiers: ["cmd"], key: "u" }}
      onAction={updateEmojiRepo}
    />
  );

  const navigationTitle = submittedSearchText
    ? `Results for "${submittedSearchText}"`
    : "Search Slack Emojis with AI";

  return (
    <Grid
      columns={5}
      searchText={searchText}
      onSearchTextChange={(text) => {
        setSearchText(text);
        if (text.trim() === "") {
          setSubmittedSearchText("");
        }
      }}
      navigationTitle={navigationTitle}
      filtering={false}
      isLoading={isLoading}
      searchBarPlaceholder="Type a feeling and press Enter to search..."
      actions={
        // Global actions for the Grid
        <ActionPanel>
          <Action
            title="Search Emojis"
            icon={Icon.MagnifyingGlass}
            onAction={handleSubmitSearch}
          />
          {submittedSearchText && (
            <Action
              title="New Search"
              icon={Icon.ArrowCounterClockwise}
              shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
              onAction={handleClearSearch}
            />
          )}
          <UpdateRepoAction />
        </ActionPanel>
      }
    >
      {searchText.length === 0 && emojis.length === 0 && !isLoading ? (
        <Grid.EmptyView
          icon={{ source: "bufo-offers-you-the-best-emoji-culture-ever.png" }}
          title="Type a feeling or phrase to search emojis with AI"
          description="Press Enter to search with AI"
        />
      ) : (
        emojis.map((emoji) => (
          <Grid.Item
            key={emoji.keywords[0]}
            content={{ source: emoji.emojiPath }}
            title={emoji.keywords[0]}
            accessory={
              emoji.keywords.length > 1
                ? {
                    icon: Icon.PersonLines,
                    tooltip:
                      "This emoji has aliases. Use the actions menu to see the alias list.",
                  }
                : undefined
            }
            actions={
              <ActionPanel>
                <Action
                  title="Search Emojis"
                  icon={Icon.MagnifyingGlass}
                  onAction={handleSubmitSearch}
                />
                <Action.Paste
                  title="Paste emoji"
                  content={`:${emoji.keywords[0]}:`}
                  shortcut={{ modifiers: ["cmd"], key: "v" }}
                />
                <Action.CopyToClipboard
                  title="Copy name to clipboard"
                  content={`:${emoji.keywords[0]}:`}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
                <Action
                  title="Copy image to clipboard"
                  icon={Icon.Image}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                  onAction={async () => {
                    const file = emoji.emojiPath;
                    try {
                      const fileContent: Clipboard.Content = { file };
                      await Clipboard.copy(fileContent);
                    } catch (error) {
                      showToast(
                        Toast.Style.Failure,
                        "Could not copy image",
                        `Reason: ${error instanceof Error ? error.message : "Unknown error"}`,
                      );
                    }
                  }}
                />
                {emoji.keywords.length > 1 && (
                  <Action.Push
                    title="Show aliases"
                    icon={Icon.PersonLines}
                    shortcut={{ modifiers: ["cmd"], key: "l" }}
                    target={<AliasList emoji={emoji} />}
                  />
                )}
                <Action
                  title="New Search"
                  icon={Icon.ArrowCounterClockwise}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                  onAction={handleClearSearch}
                />
                <UpdateRepoAction />
              </ActionPanel>
            }
          />
        ))
      )}
    </Grid>
  );
}
