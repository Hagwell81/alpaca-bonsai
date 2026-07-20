---
sidebar_position: 4
title: Conversation Features
description: Branching, editing, regeneration, and advanced conversation management
---

# Conversation Features

Alpaca treats conversations as tree structures rather than linear threads. This enables powerful features like branching, editing with history preservation, and comparing alternative responses.

## Conversation Tree Structure

Every conversation is stored as a tree in the database:

```
Root
└── System Message (optional)
    └── User: "Explain quantum computing"
        ├── Assistant: "Quantum computing is..." (Response A)
        │   └── User: "Give me an example"
        │       └── Assistant: "One example is..."
        └── Assistant: "In simple terms..." (Response B) [regenerated]
            └── User: "Give me an example"
                └── Assistant: "Sure! Imagine..."
```

The **active path** (shown in the main chat view) is the branch you are currently viewing.

## Message Actions

Each message has a set of action buttons that appear on hover:

### Copy

Click the **copy icon** to copy message content to clipboard.

- Code blocks include syntax-highlighted formatting
- Attachments are copied as references

### Edit

Click the **pencil icon** to edit a message:

**For User Messages:**
- **Branch**: Creates a new conversation branch starting from the edited message. The original branch is preserved.
- **Replace**: Overwrites the message in place (destructive)

**For Assistant Messages:**
- Edit the message content directly
- Save with branching to preserve the original

### Regenerate

Click the **refresh icon** on an assistant message to get a new response:

1. The AI generates a new response to the same parent message
2. The new response becomes a sibling of the original
3. Use the **left/right arrows** to navigate between siblings

### Continue

If a response was cut off (reached max tokens), click the **continue icon** to append more text:

1. The AI continues from where it left off
2. The existing message is extended, not replaced

### Fork

Create a new conversation starting from any message:

1. Click the **fork icon**
2. Enter a name for the new conversation
3. Choose whether to include file attachments
4. A new conversation is created with the selected message as the root

### Delete

Click the **trash icon** to remove a message:

- **Cascade Delete**: Removes the message and all its descendants
- A confirmation dialog shows how many messages will be deleted

## Branch Navigation

When a message has siblings (alternative versions), branching controls appear:

```
◀ 2 / 5 ▶
```

- **◀**: Navigate to the previous sibling
- **▶**: Navigate to the next sibling
- **2 / 5**: Current position and total siblings

:::tip Keyboard Navigation
Use `Alt+←` and `Alt+→` to quickly switch between sibling responses.
:::

## Conversation Management

### Renaming Conversations

Conversations are automatically named based on the first message. To rename:

1. Right-click the conversation in the sidebar
2. Select **Rename**
3. Enter a new name

Or click the title in the chat header.

### Searching Conversations

Use the search box in the sidebar to find conversations by title or content.

### Deleting Conversations

**Single Conversation:**
1. Right-click in the sidebar
2. Select **Delete**
3. Confirm in the dialog

**All Conversations:**
1. Open **Settings** → **Import/Export**
2. Click **Delete All Conversations**
3. Confirm (this action cannot be undone)

## System Messages

System messages define the AI's behavior for the entire conversation.

### Adding a System Message

1. Click the **+** menu in the chat header
2. Select **Add System Prompt**
3. Enter instructions (e.g., "You are a Python expert. Respond with code examples.")

### Editing System Messages

Click the pencil icon on the system message bubble to edit.

### Removing System Messages

Click the trash icon on the system message. If the conversation only contains the system message, the entire conversation is deleted.

## Message Statistics

Assistant messages display generation statistics (when enabled in settings):

| Statistic | Description |
|-----------|-------------|
| **Prompt Tokens** | Tokens in the input context |
| **Completion Tokens** | Tokens generated in the response |
| **Total Tokens** | Sum of prompt + completion |
| **Tokens/Second** | Generation speed |
| **Prompt Time** | Time to process the prompt |
| **Predict Time** | Time to generate the response |
| **Model** | Name of the model that generated the response |

## Raw Output Mode

Toggle **Raw Output** to see the unformatted response:

- Useful for debugging formatting issues
- Shows the exact text returned by the model
- Does not affect storage — only the display

## Tips for Effective Conversation Management

### Use Branching for Exploration

When exploring a topic, branch the conversation to try different angles without losing your original path:

1. Send an initial question
2. Regenerate the response if you want alternatives
3. Navigate between siblings to compare approaches
4. Continue the most promising branch

### Keep Conversations Focused

Create new conversations for distinct topics rather than mixing everything into one thread. This improves:

- Context relevance
- Searchability
- Organization

### Use Fork for Variations

When you want to explore a side topic without derailing the main conversation:

1. Find the message where the topic diverges
2. Fork the conversation
3. Continue the exploration in the forked conversation

### Clean Up Regularly

Delete unused conversations to keep the sidebar manageable. Export important conversations before deletion if you want to keep a backup.

## Troubleshooting

### Lost Conversation Branch

If you navigate to a sibling and can't find your original path:

1. Use the branching controls (◀ ▶) to cycle through siblings
2. Check the sidebar for the conversation name — it may have auto-renamed

### Edit Didn't Save

If an edit doesn't seem to take effect:

1. Check if you selected **Branch** vs **Replace**
2. Branching creates a new path — the original is still accessible via siblings

### Siblings Not Showing

If branching controls don't appear:

1. Ensure the message actually has siblings (regenerate to create them)
2. Check that **Show Branching Controls** is enabled in settings
