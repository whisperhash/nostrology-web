/**
 * File logging setup for the SvelteKit production server.
 *
 * Intercepts console.log/warn/error/info to also write to a log file.
 * Log file is created at LOG_DIR/frontend/YYYYMMDD-HHMMSS.log on startup.
 * If LOG_DIR doesn't exist or isn't writable, file logging is skipped.
 *
 * Usage: node -r ./log-setup.cjs build
 */

'use strict';

const fs = require('fs');
const path = require('path');

const logDir = process.env.LOG_DIR || '/app/logs';

let writable = false;
try {
	fs.accessSync(logDir, fs.constants.W_OK);
	writable = true;
} catch {
	// LOG_DIR doesn't exist or isn't writable — skip file logging
}

if (writable) {
	const componentDir = path.join(logDir, 'frontend');
	fs.mkdirSync(componentDir, { recursive: true });
	const now = new Date();
	const timestamp = now.toISOString().replace(/[-:T]/g, (m) => (m === 'T' ? '-' : '')).slice(0, 15);
	const logFile = path.join(componentDir, `${timestamp}.log`);
	const stream = fs.createWriteStream(logFile, { flags: 'a' });

	function formatTimestamp() {
		return new Date().toISOString().replace('T', ' ').slice(0, 19);
	}

	function writeToFile(level, args) {
		const message = args
			.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 0)))
			.join(' ');
		stream.write(`${formatTimestamp()} | ${level.padEnd(5)} | ${message}\n`);
	}

	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;
	const originalInfo = console.info;

	console.log = (...args) => {
		writeToFile('LOG', args);
		originalLog.apply(console, args);
	};
	console.info = (...args) => {
		writeToFile('INFO', args);
		originalInfo.apply(console, args);
	};
	console.warn = (...args) => {
		writeToFile('WARN', args);
		originalWarn.apply(console, args);
	};
	console.error = (...args) => {
		writeToFile('ERROR', args);
		originalError.apply(console, args);
	};

	originalLog(`File logging enabled: ${logFile}`);
}
