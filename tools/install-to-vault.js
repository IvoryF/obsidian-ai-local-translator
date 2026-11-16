#!/usr/bin/env node
/*
 * Copy the plugin into a vault so Obsidian can load it.
 *
 *   node tools/install-to-vault.js
 *   node tools/install-to-vault.js "D:\\OtherVault"
 *
 * Afterwards reload Obsidian (Ctrl+R) or toggle the plugin once.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_ID = 'ai-local-translator';
const FILES = ['main.js', 'manifest.json', 'styles.css'];

const root = path.resolve(__dirname, '..');
const vaultPath = process.argv[2] || 'D:\\projects\\O_Vault';

if (!fs.existsSync(vaultPath)) {
	process.stderr.write(`vault not found: ${vaultPath}\n`);
	process.exit(1);
}

const targetDir = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID);
fs.mkdirSync(targetDir, { recursive: true });

for (const file of FILES) {
	const source = path.join(root, file);
	if (!fs.existsSync(source)) {
		process.stderr.write(`missing file: ${source}\n`);
		process.exit(1);
	}
	fs.copyFileSync(source, path.join(targetDir, file));
}

process.stdout.write(`installed ${PLUGIN_ID} -> ${targetDir}\n`);
process.stdout.write('next: reload Obsidian (Ctrl+R), then enable the plugin.\n');
