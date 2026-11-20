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
import {
  emojiItem,
  clearEmojiCache,
  searchEmojis,
  type SearchDiagnostic,
} from "./utils";
import { warmUpLocalLLM } from "./ai";
import { runGitPull } from "./utils/runGitPull";
import { AliasList } from "./components/AliasList";
import { SearchDiagnostics } from "./components/SearchDiagnostics";

export default function Command() {
  const {
    emojiDirectory,
    typesafeApiKey,
    ignoreList,
    aiProvider,
    localEndpoint,
    localModel,
  } = getPreferenceValues<Preferences.Index>();
  const [emojis, setEmojis] = useState<emojiItem[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submittedSearchText, setSubmittedSearchText] = useState("");
  const [searchCounter, setSearchCounter] = useState(0);
  const [searchError, setSearchError] = useState<string>();
  const [diagnostics, setDiagnostics] = useState<SearchDiagnostic[]>();
  const isJev = aiProvider === "jev";

  useEffect(() => {
    if (!emojiDirectory || !fs.existsSync(emojiDirectory)) {
      showToast(
        Toast.Style.Failure,
        "Emoji directory not found",
        "Set a valid emoji directory in extension preferences.",
      );
      return;
    }
    if (!isJev && localEndpoint && localModel) {
      warmUpLocalLLM({ endpoint: localEndpoint, model: localModel }).catch(
        (error: unknown) => {
          console.warn("Local LLM warm-up failed:", error);
        },
      );
    }
  }, [emojiDirectory, isJev, localEndpoint, localModel]);

  useEffect(() => {
    if (submittedSearchText.trim() === "") {
      setEmojis([]);
      setIsLoading(false);
      setSearchError(undefined);
      setDiagnostics(undefined);
      return;
    }

    setIsLoading(true);
    setEmojis([]);
    setSearchError(undefined);
    setDiagnostics(undefined);
    const controller = new AbortController();
    const { signal } = controller;
    const parsedIgnoreList = ignoreList
      ? ignoreList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    let lastEmojis: emojiItem[] = [];
    const runSearch = async () => {
      if (isJev && !typesafeApiKey?.trim()) {
        throw new Error("Set a TypeSafe API key in extension preferences.");
      }
      if (!isJev && Boolean(localEndpoint) !== Boolean(localModel)) {
        throw new Error(
          "Set both the local LLM endpoint and model, or leave both empty.",
        );
      }
      const shared = { ignoreList: parsedIgnoreList, signal };
      await searchEmojis(
        emojiDirectory,
        submittedSearchText,
        isJev
          ? {
              ...shared,
              mode: "jev",
              apiKey: typesafeApiKey ?? "",
              onDiagnostics: (value) => {
                if (!signal.aborted) setDiagnostics(value);
              },
            }
          : {
              ...shared,
              mode: "local",
              model:
                localEndpoint && localModel
                  ? { endpoint: localEndpoint, model: localModel }
                  : undefined,
            },
        (emojis) => {
          lastEmojis = emojis;
          setEmojis(emojis);
        },
      );
    };
    runSearch()
      .then(() => {
        if (signal.aborted) return;
        if (lastEmojis.length === 0) {
          showToast(
            Toast.Style.Success,
            isJev ? "No relevant emojis found" : "No emojis found",
          );
        }
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (lastEmojis.length === 0) setSearchError(message);
        showToast(
          Toast.Style.Failure,
          lastEmojis.length
            ? "Local AI search failed; showing local matches"
            : "Emoji search failed",
          message,
        );
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [
    emojiDirectory,
    submittedSearchText,
    searchCounter,
    ignoreList,
    isJev,
    typesafeApiKey,
    localEndpoint,
    localModel,
  ]);

  const handleClearSearch = () => {
    setSearchText("");
    setSubmittedSearchText("");
    setEmojis([]);
    setSearchError(undefined);
    setDiagnostics(undefined);
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

    setSearchError(undefined);
    setIsLoading(true);
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

  const DiagnosticsAction = () =>
    diagnostics && submittedSearchText ? (
      <Action.Push
        title="Show Search Diagnostics"
        icon={Icon.List}
        shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
        target={
          <SearchDiagnostics
            query={submittedSearchText}
            diagnostics={diagnostics}
          />
        }
      />
    ) : null;

  const GlobalActions = () => (
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
      <DiagnosticsAction />
      <UpdateRepoAction />
    </ActionPanel>
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
      actions={<GlobalActions />}
    >
      {emojis.length === 0 && !submittedSearchText ? (
        <Grid.EmptyView
          icon={{ source: "bufo-offers-you-the-best-emoji-culture-ever.png" }}
          title="Type a feeling or phrase to search emojis with AI"
          description="Press Enter to search with AI"
          actions={<GlobalActions />}
        />
      ) : emojis.length === 0 && isLoading ? (
        <Grid.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Searching for emojis"
          description="Looking for matches to your search."
          actions={<GlobalActions />}
        />
      ) : emojis.length === 0 && searchError ? (
        <Grid.EmptyView
          icon={Icon.ExclamationMark}
          title="Emoji search failed"
          description={searchError}
          actions={<GlobalActions />}
        />
      ) : emojis.length === 0 ? (
        <Grid.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No matching emojis yet"
          description="Try a shorter phrase, a different word, or an emoji name."
          actions={<GlobalActions />}
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
                <DiagnosticsAction />
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
