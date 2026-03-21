import React, { useState, useEffect, useRef } from "react";
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
import os from "os";
import path from "path";
import {
  emojiItem,
  EmojiSource,
  searchEmojisStream,
  clearEmojiCache,
  clearImageCache,
} from "./utils";
import { warmUpLocalLLM } from "./ai";
import { runGitPull } from "./utils/runGitPull";
import { AliasList } from "./components/AliasList";

export default function Command() {
  const {
    emojiSource,
    emojiDirectory,
    githubEmojiRepo,
    githubEmojiBranch,
    githubToken,
    ignoreList,
    aiProvider,
    localEndpoint,
    localModel,
  } = getPreferenceValues<Preferences.Index>();

  const repoParts = (githubEmojiRepo ?? "").split("/");
  const source: EmojiSource =
    emojiSource === "github"
      ? {
          type: "github",
          owner: repoParts[0] ?? "",
          repo: repoParts[1] ?? "",
          branch: githubEmojiBranch?.trim() || "main",
        }
      : { type: "local", directory: emojiDirectory ?? "" };
  const [emojis, setEmojis] = useState<emojiItem[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submittedSearchText, setSubmittedSearchText] = useState("");
  const [searchCounter, setSearchCounter] = useState(0);
  const searchIdRef = useRef(0);
  const hasWarmedUpRef = useRef(false);

  useEffect(() => {
    if (emojiSource === "github") {
      const repo = githubEmojiRepo?.trim() ?? "";
      const parts = repo.split("/");
      if (!repo || parts.length !== 2 || !parts[0] || !parts[1]) {
        showToast(
          Toast.Style.Failure,
          "GitHub repository not configured",
          'Set a GitHub emoji repository in the format "owner/repo" in extension preferences.',
        );
        return;
      }
    } else {
      if (!emojiDirectory || !fs.existsSync(emojiDirectory)) {
        showToast(
          Toast.Style.Failure,
          "Emoji directory not found",
          "Set a valid emoji directory in extension preferences.",
        );
        return;
      }
    }
    if ((aiProvider || "github") === "local") {
      if (!localEndpoint) {
        showToast(
          Toast.Style.Failure,
          "Local LLM endpoint not set",
          "Add a local LLM endpoint URL in extension preferences.",
        );
        return;
      }
      if (!localModel) {
        showToast(
          Toast.Style.Failure,
          "Local LLM model not set",
          "Add a local model name in extension preferences.",
        );
        return;
      }
    } else {
      if (!githubToken) {
        showToast(
          Toast.Style.Failure,
          "GitHub token not set",
          "Add a GitHub PAT with models:read scope in extension preferences.",
        );
        return;
      }
    }
    // Pre-warm local LLM once on mount so the model is loaded before the first search
    if (!hasWarmedUpRef.current && (aiProvider || "github") === "local") {
      hasWarmedUpRef.current = true;
      warmUpLocalLLM();
    }
  }, [
    emojiSource,
    emojiDirectory,
    githubEmojiRepo,
    githubEmojiBranch,
    githubToken,
    aiProvider,
    localEndpoint,
    localModel,
  ]);

  useEffect(() => {
    if (submittedSearchText.trim() === "") {
      setEmojis([]);
      return;
    }

    setIsLoading(true);
    setEmojis([]);
    const searchId = ++searchIdRef.current;
    const parsedIgnoreList = ignoreList
      ? ignoreList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    let lastEmojis: emojiItem[] = [];
    searchEmojisStream(
      source,
      submittedSearchText,
      parsedIgnoreList,
      (emojis) => {
        if (searchId !== searchIdRef.current) return;
        lastEmojis = emojis;
        setEmojis(emojis);
      },
      githubToken,
    )
      .then(() => {
        if (searchId !== searchIdRef.current) return;
        if (lastEmojis.length === 0) {
          showToast(Toast.Style.Animated, "No emojis found for your query.");
        }
      })
      .catch((err) => {
        if (searchId !== searchIdRef.current) return;
        showToast(Toast.Style.Failure, "Could not load emojis", err.message);
        setEmojis([]);
      })
      .finally(() => {
        if (searchId !== searchIdRef.current) return;
        setIsLoading(false);
      });
  }, [
    emojiSource,
    emojiDirectory,
    githubEmojiRepo,
    githubEmojiBranch,
    submittedSearchText,
    searchCounter,
  ]);

  const handleClearSearch = () => {
    setSearchText("");
    setSubmittedSearchText("");
    setEmojis([]);
  };

  const updateEmojiRepo = async () => {
    if (source.type === "github") {
      clearEmojiCache();
      await clearImageCache();
      showToast({
        title:
          "Emoji cache cleared — will re-fetch from GitHub on next search.",
        style: Toast.Style.Success,
      });
      return;
    }

    showToast({
      title: "Updating emoji repository...",
      style: Toast.Style.Animated,
    });

    const { exitCode, stderr } = await runGitPull(emojiDirectory ?? "");
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
      title={
        source.type === "github" ? "Refresh Emoji Cache" : "Update Emoji Repo"
      }
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
                    const filePath = emoji.emojiPath;
                    try {
                      let localPath = filePath;
                      let tempCreated = false;
                      if (filePath.startsWith("http")) {
                        const response = await fetch(filePath);
                        if (!response.ok)
                          throw new Error(`HTTP ${response.status}`);
                        const buffer = Buffer.from(
                          await response.arrayBuffer(),
                        );
                        const ext =
                          path.extname(new URL(filePath).pathname) || ".png";
                        localPath = path.join(
                          os.tmpdir(),
                          `emoji-${Date.now()}${ext}`,
                        );
                        await fs.promises.writeFile(localPath, buffer);
                        tempCreated = true;
                      }
                      await Clipboard.copy({ file: localPath });
                      if (tempCreated) {
                        fs.promises.unlink(localPath).catch(() => {});
                      }
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
