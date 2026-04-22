---
title: AI-Supported Editing
description: Leverage AI tools to edit and automate your ScreenCI workflows.
---

ScreenCI provides multiple interfaces for AI-assisted editing, making it easy to integrate with modern AI tools and workflows.

## Markdown Access

All documentation pages are available as raw markdown files by simply appending `.md` to the URL:

- **HTML Version**: `https://docs.screenci.com/guides/editing/`
- **Markdown Version**: `https://docs.screenci.com/guides/editing.md`

This makes it easy for AI tools to fetch and process documentation content directly.

## llms.txt

ScreenCI provides a machine-readable documentation index at `/llms.txt` following the [llms.txt specification](https://llmstxt.org/). This file contains:

- A summary of ScreenCI's key features and capabilities
- Links to important documentation sections
- API reference information
- Common use cases and examples

AI assistants can use this file to quickly understand ScreenCI's functionality and provide better assistance.

**[View llms.txt →](/llms.txt)**

## Model Context Protocol (MCP) Server

ScreenCI offers a Model Context Protocol server that allows AI assistants like Claude to directly interact with your ScreenCI projects.

Before setting up the MCP server, run `npx screenci init` in your project and complete the browser login flow. That fetches your `SCREENCI_SECRET` and saves it to `.env` automatically.

### Features

The ScreenCI MCP server provides:

- **Project Access**: List and read your ScreenCI projects
- **Video Management**: Access video scripts and metadata
- **Workflow Automation**: Trigger builds and deployments
- **Real-time Updates**: Get notifications about project changes

### Installation

After you have `SCREENCI_SECRET`, install the ScreenCI MCP server using npm:

```bash
npm install -g @screenci/mcp-server
```

Or add it to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "screenci": {
      "command": "npx",
      "args": ["-y", "@screenci/mcp-server"],
      "env": {
        "SCREENCI_SECRET": "your-screenci-secret-here"
      }
    }
  }
}
```

If you already initialized a screenci project, copy the value from that project's `.env` file.

### Usage

Once configured, AI assistants can:

- Answer questions about your specific projects
- Help edit video scripts
- Suggest optimizations for your workflows
- Automate repetitive tasks

## Benefits

AI-supported editing enables:

- **Faster Iterations**: Get instant suggestions for improving your video scripts
- **Consistency**: Maintain consistent tone and style across all videos
- **Automation**: Automate routine updates like version numbers or product names
- **Learning**: AI assistants can learn your specific patterns and preferences

## Example Workflows

### Bulk Script Updates

Use AI to update multiple video scripts at once:

```
Update all scripts to use "Sign In" instead of "Log In"
```

### Content Generation

Generate new video narration based on existing patterns:

```
Create a new onboarding video script similar to the one for feature X
```

### Localization Assistance

Get help translating and adapting scripts for different regions:

```
Adapt the US onboarding script for the European market
```
