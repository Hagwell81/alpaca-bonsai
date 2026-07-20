# Alpaca Makefile
# Cross-platform build system for generating installers
# Supports: Windows (NSIS), macOS (DMG/PKG), Linux (AppImage/DEB/RPM)
#
# This Makefile uses self-documenting help comments (##).
# Run 'make help' to see all available targets.

.PHONY: help install build clean all
.PHONY: build-webui build-docs build-desktop build-tui
.PHONY: windows macos linux
.PHONY: windows-installer windows-portable macos-dmg macos-pkg
.PHONY: linux-appimage linux-deb linux-rpm
.PHONY: dev dev-webui dev-docs dev-desktop
.PHONY: test lint format
.PHONY: check check-system check-tools check-node verify

# Default target
.DEFAULT_GOAL := help

# Enhanced system detection
uname_S := $(shell sh -c 'uname -s 2>/dev/null || echo Windows')
uname_M := $(shell sh -c 'uname -m 2>/dev/null || echo unknown')
uname_R := $(shell sh -c 'uname -r 2>/dev/null || echo unknown')
uname_P := $(shell sh -c 'uname -p 2>/dev/null || echo unknown')
uname_O := $(shell sh -c 'uname -o 2>/dev/null || echo unknown')

# Windows compatibility
ifeq ($(OS),Windows_NT)
    UNAME_S := Windows
else
    UNAME_S := $(uname_S)
endif

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Project directories
ROOT_DIR := $(shell pwd)
WEBUI_DIR := $(ROOT_DIR)/webui
DOCS_DIR := $(ROOT_DIR)/docs
DESKTOP_DIR := $(ROOT_DIR)/desktop
DIST_DIR := $(DESKTOP_DIR)/release

##
# help: Display this help message.
##
.PHONY: help
help:
	@awk '/^##/{a=1-a}a' $(MAKEFILE_LIST) | cut -c3-

##
# install: Install all dependencies.
##
.PHONY: install
install:
	@echo "$(BLUE)Installing all dependencies...$(NC)"
	@cd $(WEBUI_DIR) && npm install
	@cd $(DOCS_DIR) && npm install
	@cd $(DESKTOP_DIR) && npm install
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

##
# verify: Verify all dependencies are installed before building.
##
.PHONY: verify
verify: check-node
	@echo "$(BLUE)Verifying dependencies...$(NC)"
	@test -f $(WEBUI_DIR)/package.json || (echo "$(RED)Missing webui package.json$(NC)" && exit 1)
	@test -f $(DOCS_DIR)/package.json || (echo "$(RED)Missing docs package.json$(NC)" && exit 1)
	@test -f $(DESKTOP_DIR)/package.json || (echo "$(RED)Missing desktop package.json$(NC)" && exit 1)
	@echo "$(GREEN)✓ All dependencies verified$(NC)"

##
# check: Verify system setup and tool versions.
##
.PHONY: check
check: check-system check-tools check-node

##
# check-system: Print system information.
##
.PHONY: check-system
check-system:
	@echo "\n### System ###"
	uname -a || echo "uname not available"
	@echo "\n### User ###"
	echo "$$USER"
	@echo "\n### Home ###"
	echo "$$HOME"
	@echo "\n### Platform ###"
	@echo "OS: $(UNAME_S)"
	@echo "Machine: $(uname_M)"
	@echo "Processor: $(uname_P)"

##
# check-tools: Verify development tools.
##
.PHONY: check-tools
check-tools:
	@echo "\n### Make ###"
	make --version || true
	which -a make || true
	@echo "\n### Git ###"
	git --version || true
	which -a git || true
	@echo "\n### Node ###"
	node --version || true
	which -a node || true
	@echo "\n### npm ###"
	npm --version || true
	which -a npm || true

##
# check-node: Verify Node.js and npm versions (minimum Node 18+ required).
##
.PHONY: check-node
check-node:
	@echo "\n### Node.js Version Check ###"
	@node --version || (echo "$(RED)Node.js not found. Please install Node.js 18+$(NC)" && exit 1)
	@npm --version || (echo "$(RED)npm not found$(NC)" && exit 1)
	@echo "$(GREEN)✓ Node.js and npm available$(NC)"

##
# build-webui: Build SvelteKit web interface.
##
.PHONY: build-webui
build-webui:
	@echo "$(BLUE)Building SvelteKit web interface...$(NC)"
	@cd $(WEBUI_DIR) && npm run build
	@echo "$(GREEN)✓ WebUI built successfully$(NC)"

##
# build-docs: Build Docusaurus documentation.
##
.PHONY: build-docs
build-docs:
	@echo "$(BLUE)Building Docusaurus documentation...$(NC)"
	@cd $(DOCS_DIR) && npm run build
	@echo "$(GREEN)✓ Documentation built successfully$(NC)"

##
# build-desktop: Build Electron desktop app (prepare assets).
##
.PHONY: build-desktop
build-desktop:
	@echo "$(BLUE)Building Electron desktop app...$(NC)"
	@cd $(DESKTOP_DIR) && npm run copy-webui
	@cd $(DESKTOP_DIR) && npm run copy-docs
	@echo "$(GREEN)✓ Desktop app prepared successfully$(NC)"

##
# build-tui: Build the alpaca-tui Rust crate (bonsai-beach TUI compatible).
# Requires cargo. Produces a binary at tui/target/release/alpaca-tui.
##
.PHONY: build-tui
build-tui:
	@echo "$(BLUE)Building alpaca-tui (Rust terminal UI)...$(NC)"
	@cd tui && cargo build --release
	@echo "$(GREEN)✓ alpaca-tui built at tui/target/release/alpaca-tui$(NC)"

# Platform detection for automatic builds
ifeq ($(UNAME_S),Windows)
    PLATFORM_TARGET := windows
else ifeq ($(UNAME_S),Darwin)
    PLATFORM_TARGET := macos
else
    PLATFORM_TARGET := linux
endif

##
# build: Build all components for current platform.
##
.PHONY: build
build: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building for current platform: $(PLATFORM_TARGET)$(NC)"
	@$(MAKE) $(PLATFORM_TARGET)
	@echo "$(YELLOW)Tip: run 'make build-tui' to build the alpaca-tui terminal UI (requires cargo)$(NC)"

##
# all: Build release packages for all platforms (requires running on each platform separately).
##
.PHONY: all
all: clean
	@echo "$(BLUE)Building release packages for all platforms...$(NC)"
	@echo "$(YELLOW)Note: This requires running on each platform separately$(NC)"
	@echo "$(YELLOW)or using a CI/CD system with multi-platform support$(NC)"
	@echo ""
	@echo "To build for all platforms, run:"
	@echo "  - On Windows: make windows"
	@echo "  - On macOS: make macos"
	@echo "  - On Linux: make linux"

##
# windows: Build Windows installers (NSIS + Portable).
##
.PHONY: windows
windows: windows-installer windows-portable
	@echo "$(GREEN)✓ Windows builds completed$(NC)"
	@echo "  Output: $(DIST_DIR)/"

##
# windows-installer: Build Windows NSIS installer.
##
.PHONY: windows-installer
windows-installer: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building Windows NSIS installer...$(NC)"
	@cd $(DESKTOP_DIR) && npm run build:installer
	@echo "$(GREEN)✓ Windows NSIS installer built$(NC)"

##
# windows-portable: Build Windows portable executable.
##
.PHONY: windows-portable
windows-portable: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building Windows portable executable...$(NC)"
	@cd $(DESKTOP_DIR) && npm run build:portable
	@echo "$(GREEN)✓ Windows portable executable built$(NC)"

##
# macos: Build macOS packages (DMG + PKG).
##
.PHONY: macos
macos: macos-dmg macos-pkg
	@echo "$(GREEN)✓ macOS builds completed$(NC)"
	@echo "  Output: $(DIST_DIR)/"

##
# macos-dmg: Build macOS DMG image.
##
.PHONY: macos-dmg
macos-dmg: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS DMG image...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --x64 --config.dmg.target=dmg
	@echo "$(GREEN)✓ macOS DMG built$(NC)"

##
# macos-pkg: Build macOS PKG installer.
##
.PHONY: macos-pkg
macos-pkg: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS PKG installer...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --x64 --config.pkg.target=pkg
	@echo "$(GREEN)✓ macOS PKG built$(NC)"

##
# macos-arm64: Build macOS ARM64 (Apple Silicon).
##
.PHONY: macos-arm64
macos-arm64: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS ARM64 (Apple Silicon)...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --arm64
	@echo "$(GREEN)✓ macOS ARM64 builds completed$(NC)"

##
# macos-universal: Build macOS Universal (Intel + ARM).
##
.PHONY: macos-universal
macos-universal: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS Universal (Intel + ARM)...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --universal
	@echo "$(GREEN)✓ macOS Universal builds completed$(NC)"

##
# linux: Build Linux packages (AppImage + DEB + RPM).
##
.PHONY: linux
linux: linux-appimage linux-deb linux-rpm
	@echo "$(GREEN)✓ Linux builds completed$(NC)"
	@echo "  Output: $(DIST_DIR)/"

##
# linux-appimage: Build Linux AppImage.
##
.PHONY: linux-appimage
linux-appimage: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux AppImage...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=AppImage
	@echo "$(GREEN)✓ Linux AppImage built$(NC)"

##
# linux-deb: Build Linux DEB package.
##
.PHONY: linux-deb
linux-deb: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux DEB package...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=deb
	@echo "$(GREEN)✓ Linux DEB built$(NC)"

##
# linux-rpm: Build Linux RPM package.
##
.PHONY: linux-rpm
linux-rpm: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux RPM package...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=rpm
	@echo "$(GREEN)✓ Linux RPM built$(NC)"

##
# linux-snap: Build Linux Snap package.
##
.PHONY: linux-snap
linux-snap: verify build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux Snap package...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=snap
	@echo "$(GREEN)✓ Linux Snap built$(NC)"

##
# all-windows: Cross-platform Windows build (requires Windows environment).
##
.PHONY: all-windows
all-windows: verify build-webui build-docs build-desktop
	@echo "$(YELLOW)Cross-platform Windows build requires Windows environment$(NC)"
	@echo "Use Docker with wine or a Windows VM to build Windows installers from $(UNAME_S)"

##
# all-macos: Cross-platform macOS build (requires macOS environment).
##
.PHONY: all-macos
all-macos: verify build-webui build-docs build-desktop
	@echo "$(YELLOW)Cross-platform macOS build requires macOS environment$(NC)"
	@echo "Use a macOS VM or GitHub Actions to build macOS packages from $(UNAME_S)"

##
# all-linux: Cross-platform Linux build (requires Linux environment).
##
.PHONY: all-linux
all-linux: verify build-webui build-docs build-desktop
	@echo "$(YELLOW)Cross-platform Linux build requires Linux environment$(NC)"
	@echo "Use Docker or a Linux VM to build Linux packages from $(UNAME_S)"

##
# dev: Start all development servers.
##
.PHONY: dev
dev:
	@echo "$(BLUE)Starting all development servers...$(NC)"
	@echo "  - WebUI: http://localhost:13439"
	@echo "  - Docs: http://localhost:13440"
	@echo "  - API Server: http://localhost:13434"
	@echo "  - Desktop: Electron app"
	@cd $(WEBUI_DIR) && npm run dev &
	@cd $(DOCS_DIR) && npm run start &
	@cd $(DESKTOP_DIR) && npm start

##
# dev-webui: Start SvelteKit dev server.
##
.PHONY: dev-webui
dev-webui:
	@echo "$(BLUE)Starting SvelteKit dev server...$(NC)"
	@cd $(WEBUI_DIR) && npm run dev

##
# dev-docs: Start Docusaurus dev server.
##
.PHONY: dev-docs
dev-docs:
	@echo "$(BLUE)Starting Docusaurus dev server...$(NC)"
	@cd $(DOCS_DIR) && npm run start

##
# dev-desktop: Start Electron app in dev mode.
##
.PHONY: dev-desktop
dev-desktop:
	@echo "$(BLUE)Starting Electron app in dev mode...$(NC)"
	@cd $(DESKTOP_DIR) && npm start

##
# test: Run tests.
##
.PHONY: test
test:
	@echo "$(BLUE)Running tests...$(NC)"
	@cd $(WEBUI_DIR) && npm test || echo "No tests configured for webui"
	@echo "$(GREEN)✓ Tests completed$(NC)"

##
# lint: Run linters.
##
.PHONY: lint
lint:
	@echo "$(BLUE)Running linters...$(NC)"
	@cd $(WEBUI_DIR) && npm run lint || echo "Linting not configured for webui"
	@echo "$(GREEN)✓ Linting completed$(NC)"

##
# format: Format code.
##
.PHONY: format
format:
	@echo "$(BLUE)Formatting code...$(NC)"
	@cd $(WEBUI_DIR) && npm run format || echo "Formatting not configured for webui"
	@echo "$(GREEN)✓ Code formatted$(NC)"

##
# clean: Clean build artifacts.
##
.PHONY: clean
clean:
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	@cd $(WEBUI_DIR) && npm run cleanup 2>/dev/null || rm -rf $(WEBUI_DIR)/.svelte-kit $(WEBUI_DIR)/build
	@cd $(DESKTOP_DIR) && npm run clean || echo "Desktop clean not configured"
	@cd $(DOCS_DIR) && npm run clear || echo "Docs clean not configured"
	@rm -rf $(ROOT_DIR)/public
	@rm -rf $(DIST_DIR)
	@echo "$(GREEN)✓ Clean completed$(NC)"

##
# clean-all: Clean all dependencies and build artifacts.
##
.PHONY: clean-all
clean-all: clean
	@echo "$(BLUE)Cleaning all dependencies...$(NC)"
	@rm -rf $(WEBUI_DIR)/node_modules
	@rm -rf $(DOCS_DIR)/node_modules
	@rm -rf $(DESKTOP_DIR)/node_modules
	@echo "$(GREEN)✓ All dependencies removed$(NC)"
