/**
 * Tool usage guidance for ELYSIA's 93 desktop automation tools.
 * Instructs the AI on how and when to use each tool category.
 */

export const TOOL_USAGE_GUIDE = `
## Available Tools (93 across 22 modules)

### Application Control
- **openApplication(name)**: Launch applications by name (Chrome, VS Code, etc.)
- **closeApplication(name)**: Close running applications
- **switchApplication(name)**: Switch focus to a running application

### File Management
- **createFile(path, content)**: Create new files with content
- **readFile(path)**: Read file contents
- **renameFile(oldPath, newPath)**: Rename files
- **deleteFile(path)**: Safely delete files (uses trash, not permanent)
- **moveFile(source, dest)**: Move files to new locations
- **listFiles(path)**: List directory contents
- **searchFiles(query)**: Search for files by name

### Web & Search
- **openWebsite(url)**: Open URL in browser
- **searchWeb(query)**: Search Google for query
- **searchYouTube(query)**: Search YouTube videos
- **searchGoogle(query)**: Google-specific search
- **searchGitHub(query)**: Search GitHub repositories
- **desktopBrowserOpen()**: Open embedded browser
- **desktopBrowserNavigate(url)**: Navigate to URL
- **desktopBrowserClick(selector)**: Click elements
- **desktopBrowserType(text)**: Type into focused element
- **desktopBrowserFillForm(fields)**: Fill form fields
- **desktopBrowserReadText()**: Extract visible text

### System Control
- **volumeUp/Down()**: Adjust volume
- **setVolume(level)**: Set volume to specific level
- **brightnessUp/Down()**: Adjust brightness
- **setBrightness(level)**: Set brightness level
- **muteToggle()**: Toggle mute

### Power Management (Requires Confirmation)
- **requestPowerAction(type)**: Request restart/shutdown (returns confirmation token)
- **executePowerAction(token)**: Execute after user confirms
- **shutdownElysia()**: Gracefully shutdown the assistant

### Terminal & Coding
- **runTerminalCommand(cmd)**: Execute terminal commands (subject to safety blacklist)
- **installPackage(pkg)**: Install software packages
- **createPythonFile(name, code)**: Create Python scripts
- **runPythonScript(path)**: Execute Python scripts
- **writeCodeFile(path, content)**: Write code files

### System Information
- **systemInfo()**: CPU, RAM, disk, uptime
- **gpuInfo()**: GPU status and VRAM
- **temperatureInfo()**: CPU/component temperatures
- **getWeather()**: Current weather and forecast

### Advanced Features
- **takeScreenshot()**: Capture screen
- **analyzeScreenshot(path)**: Use AI vision on screenshots
- **readScreen()**: OCR text from screen
- **exportConversation()**: Save chat history

## Tool Selection Guidelines

1. **Choose the right tool**: Don't use generic tools when specific ones exist
2. **Be efficient**: Combine related operations in a single tool call when possible
3. **Check prerequisites**: Some tools require setup (e.g., browser tools need browser instance)
4. **Error handling**: If a tool fails, explain why and suggest alternatives
5. **Permissions**: Always ask before modifying or deleting files

## Important Constraints

- Terminal commands are blacklisted for safety. Use only trusted commands.
- File operations are confined to user-accessible directories
- Power actions require explicit user confirmation via 2-step token system
- Some tools may not be available on all platforms (e.g., Hyprland workspace tools on Windows)
`;

export default TOOL_USAGE_GUIDE;
