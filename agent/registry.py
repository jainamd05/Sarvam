"""
ELYSIA Desktop Control Agent — Central tool registry.

Each tool module registers handlers into a flat dict `TOOLS` mapping
tool_name -> callable(args: dict) -> dict.

Handlers return a plain dict, typically {"result": "<status string>"}.
Errors should raise ToolError(message) so main.py can map them to {error}.
Shared singletons (Playwright browser/page, confirmation store, etc.) live
on the `State` object so handlers stay stateless and easy to test.
"""

from __future__ import annotations

import importlib
import threading
from typing import Any, Callable, Dict


class ToolError(Exception):
    """Raised by a tool handler to signal a clean, user-facing failure."""

    def __init__(self, message: str, *, fatal: bool = False):
        super().__init__(message)
        self.message = message
        self.fatal = fatal


class State:
    """Process-wide shared state for tool handlers."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        # Confirmation tokens for dangerous (power) actions.
        # token -> {"action": <tool_name>, "expires": <epoch>}
        self.confirmations: Dict[str, Dict[str, Any]] = {}
        # Playwright singletons — lazily initialized on first browser tool use.
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None

        # Sudo command store: command_id -> { command, expires_at }
        self.sudo_commands: Dict[str, Dict[str, Any]] = {}

    def reset_playwright(self) -> None:
        """Tear down any cached Playwright resources (used on errors)."""
        try:
            if self.page is not None:
                self.page = None
            if self.context is not None:
                self.context = None
            if self.browser is not None:
                self.browser = None
            if self.playwright is not None:
                self.playwright = None
        except Exception as e:
            import logging
            logging.warning("Failed to clean up Playwright resources (best-effort): %s", e)


STATE = State()

# tool_name -> handler(args: dict) -> dict
TOOLS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}


def register(name: str):
    """Decorator to register a handler under a tool name."""

    def deco(fn: Callable[[Dict[str, Any]], Dict[str, Any]]):
        TOOLS[name] = fn
        return fn

    return deco


# The set of all tool names ELYSIA may route to this agent.
# Kept in sync with the functionDeclarations added in src/server/index.ts.
DESKTOP_TOOL_NAMES = [
    # ==== Applications & Websites ====
    "openApplication",
    "closeApplication",
    "openWebsite",
    
    # ==== Search ====
    "searchWeb",
    "searchYouTube",
    "searchGoogle",
    "searchGitHub",
    
    # ==== Files ====
    "createFile",
    "readFile",
    "renameFile",
    "deleteFile",
    "moveFile",
    "openFolder",
    "listFiles",
    "searchFiles",
    
    # ==== PC Control (Volume, Power) ====
    "volumeUp",
    "volumeDown",
    "muteToggle",
    "setVolume",
    "brightnessUp",
    "brightnessDown",
    "setBrightness",
    "requestPowerAction",
    "executePowerAction",
    
    # ==== Window Management ====
    "minimizeWindow",
    "maximizeWindow",
    "closeWindow",
    "switchApplication",
    
    # ==== Clipboard ====
    "copySelected",
    "pasteClipboard",
    "getClipboard",
    "clearClipboard",
    
    # ==== Screenshot & Screen Reading ====
    "takeScreenshot",
    "saveScreenshot",
    "analyzeScreenshot",
    "readScreen",
    
    # ==== Desktop Browser (Playwright - CDP/Managed) ====
    "desktopBrowserOpen",
    "desktopBrowserNavigate",
    "desktopBrowserOpenTab",
    "desktopBrowserCloseTab",
    "desktopBrowserSearch",
    "desktopBrowserOpenYoutubeVideo",
    "desktopBrowserClick",
    "desktopBrowserType",
    "desktopBrowserFillForm",
    "desktopBrowserGoBack",
    "desktopBrowserGoForward",
    "desktopBrowserScroll",
    "desktopBrowserReadText",
    "desktopBrowserGetLinks",
    "desktopBrowserSetMode",
    "browserMediaControl",
    "browserTabAction",
    
    # ==== Coding Assistance ====
    "createPythonFile",
    "runPythonScript",
    "createProjectFolder",
    "writeCodeFile",
    
    # ==== System Information ====
    "systemInfo",
    "gpuInfo",
    "temperatureInfo",
    
    # ==== Windows Auto-Start ====
    "enableAutoStart",
    "disableAutoStart",
    "getAutoStartStatus",
    
    # ==== Terminal ====
    "requestTerminalAction",
    "runTerminalCommand",
    "provideSudoPassword",
    "installPackage",
    "isCommandAllowed",
    
    # ==== IITM (Education) ====
    "iitmQuickLinks",
    "iitmOpen",
    "iitmOpenCustom",
    
    # ==== Power & Shutdown ====
    "shutdownElysia",
    
    # ==== Weather ====
    "getWeather",
    
    # ==== OS Input (Keyboard/Mouse) ====
    "osType",
    "osPress",
    "osClick",
    
    # ==== Hyprland (Wayland Workspaces) ====
    "switchWorkspace",
    "listWorkspaces",
    "moveToWorkspace",
    
    # ==== News ====
    "getNews",
    
    # ==== Conversation Export ====
    "exportConversation",
    "listExports",
    
    # ==== Google Workspace (Calendar, Gmail, Tasks) ====
    "getCalendarEvents",
    "createCalendarEvent",
    "sendEmail",
    "getEmails",
    "getTasks",
    "createTask",
    
    # ==== Camera Control ====
    "cameraList",
    "cameraOn",
    "cameraOff",
]


# --- Eagerly import all tool modules so their @register decorators run. ---
# Each module is imported defensively: a hard import failure here would make
# the whole agent unstartable, which we want to avoid. The modules themselves
# keep optional-dependency imports lazy/try-except.



def load_all() -> None:
    import agent.tools.confirmation
    import agent.tools.applications
    import agent.tools.websites
    import agent.tools.search
    import agent.tools.files
    import agent.tools.pc
    import agent.tools.windows
    import agent.tools.clipboard
    import agent.tools.screenshot
    import agent.tools.browser
    import agent.tools.coding
    import agent.tools.system
    import agent.tools.startup
    import agent.tools.terminal
    import agent.tools.iitm
    import agent.tools.weather
    import agent.tools.hyprland
    import agent.tools.news
    import agent.tools.conversation
    import agent.tools.os_input
    import agent.tools.google
    import agent.tools.camera


__all__ = ["TOOLS", "STATE", "DESKTOP_TOOL_NAMES", "ToolError", "register", "load_all"]
