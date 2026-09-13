#!/usr/bin/env node
// pi-telegram CLI — small companion to the pi-telegram bridge extension.
//
// Reads the same config as the extension (~/.pi/agent/telegram.json) so scripts
// and non-agent runners can send messages to the paired Telegram chat without
// going through a pi session.
//
// Usage:
//   pi-telegram send "text..."     Send a message to the paired chat
//                                  (reads stdin instead when no text argument
//                                  is given)
//   pi-telegram --help             Show this help

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "telegram.json");
const MAX_MESSAGE_LENGTH = 4096;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function usage() {
	console.log(`pi-telegram — companion CLI for the pi-telegram bridge extension

Usage:
  pi-telegram send "text..."   Send a message to the paired Telegram chat.
                               With no text argument, reads the message from stdin.
  pi-telegram --help           Show this help.

Config is read from ${CONFIG_PATH} (botToken + allowedUserId must be set,
i.e. the bridge extension has been set up and paired at least once).`);
}

function fail(message) {
	console.error(`pi-telegram: ${message}`);
	process.exit(1);
}

async function readConfig() {
	let raw;
	try {
		raw = await readFile(CONFIG_PATH, "utf8");
	} catch {
		fail(`cannot read config at ${CONFIG_PATH}. Set up the pi-telegram bridge first (pi + /telegram-setup).`);
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		fail(`config at ${CONFIG_PATH} is not valid JSON: ${error.message}`);
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTelegram(botToken, method, body) {
	let lastError;
	for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			let data;
			try {
				data = await response.json();
			} catch {
				data = null; // non-JSON body (e.g. an HTML error page)
			}
			if (data && data.ok && data.result !== undefined) return data.result;
			const errorCode = data?.error_code ?? response.status;
			lastError = new Error(data?.description || `Telegram API ${method} failed (HTTP ${response.status})`);
			lastError.retryable = RETRYABLE_STATUS_CODES.has(errorCode);
			lastError.retryAfter = data?.parameters?.retry_after;
		} catch (error) {
			// Network-level failure (fetch rejected): treat as transient.
			lastError = error;
			lastError.retryable = true;
		}
		if (!lastError.retryable || attempt >= RETRY_MAX_ATTEMPTS) break;
		const delay = lastError.retryAfter !== undefined ? lastError.retryAfter * 1000 : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
		await sleep(delay);
	}
	throw lastError;
}

function chunkText(text) {
	if (text.length <= MAX_MESSAGE_LENGTH) return [text];
	const chunks = [];
	for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
		chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
	}
	return chunks;
}

async function cmdSend(args) {
	let text = args.join(" ").trim();
	if (!text) {
		const chunks = [];
		for await (const chunk of process.stdin) chunks.push(chunk);
		text = Buffer.concat(chunks).toString("utf8").trim();
	}
	if (!text) fail("nothing to send: pass a message as an argument or pipe one via stdin");

	const config = await readConfig();
	if (!config.botToken) fail("botToken missing in config; run /telegram-setup in pi first");
	if (config.allowedUserId === undefined) fail("allowedUserId missing in config; pair the bot first (send /start in Telegram)");

	for (const chunk of chunkText(text)) {
		await callTelegram(config.botToken, "sendMessage", {
			chat_id: config.allowedUserId,
			text: chunk,
		});
	}
	console.log(`Sent to Telegram (${text.length} chars).`);
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (!command || command === "--help" || command === "-h" || command === "help") {
		usage();
		if (!command) process.exit(1);
		return;
	}
	if (command === "send") return cmdSend(args);
	usage();
	fail(`unknown command: ${command}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
