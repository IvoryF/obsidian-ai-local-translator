/*
 * Headless smoke tests for AI Local Translator.
 *
 * Obsidian is not available outside the app, so this file stubs the `obsidian`
 * module plus a tiny DOM. It exercises the parts that are easy to break:
 * endpoint resolution, request shaping, response parsing, prompt building and
 * the vocabulary writer.
 *
 *   node test/smoke.js
 */

'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/* ------------------------------------------------------------------ fake DOM */

class FakeEl {
	constructor(tag, opts) {
		const options = opts || {};
		this.tagName = String(tag || 'div').toUpperCase();
		this.children = [];
		this.parentEl = null;
		this.classes = new Set(String(options.cls || '').split(/\s+/).filter(Boolean));
		this.textContent = options.text == null ? '' : String(options.text);
		this.style = {};
		this.attrs = {};
		this.listeners = {};
	}

	createDiv(opts) {
		return this.appendChild(new FakeEl('div', opts));
	}

	createSpan(opts) {
		return this.appendChild(new FakeEl('span', opts));
	}

	createEl(tag, opts) {
		return this.appendChild(new FakeEl(tag, opts));
	}

	appendChild(child) {
		child.parentEl = this;
		this.children.push(child);
		return child;
	}

	setText(text) {
		this.textContent = String(text);
		return this;
	}

	getText() {
		return this.textContent;
	}

	empty() {
		this.children = [];
		this.textContent = '';
		return this;
	}

	addClass(cls) {
		this.classes.add(cls);
		return this;
	}

	removeClass(cls) {
		this.classes.delete(cls);
		return this;
	}

	toggleClass(cls, value) {
		if (value) this.classes.add(cls);
		else this.classes.delete(cls);
		return this;
	}

	hasClass(cls) {
		return this.classes.has(cls);
	}

	setAttribute(key, value) {
		this.attrs[key] = String(value);
	}

	getAttribute(key) {
		return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
	}

	removeAttribute(key) {
		delete this.attrs[key];
	}

	addEventListener(type, callback) {
		(this.listeners[type] = this.listeners[type] || []).push(callback);
	}

	removeEventListener() {}

	remove() {
		if (this.parentEl) {
			const index = this.parentEl.children.indexOf(this);
			if (index >= 0) this.parentEl.children.splice(index, 1);
			this.parentEl = null;
		}
	}

	getBoundingClientRect() {
		return { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 };
	}

	contains(node) {
		if (!node) return false;
		if (node === this) return true;
		return this.children.some((child) => child.contains(node));
	}

	closest(selector) {
		const parts = String(selector)
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);
		let current = this;
		while (current) {
			const matched = parts.some((part) => {
				if (part.startsWith('.')) return current.hasClass(part.slice(1));
				return current.tagName === part.toUpperCase();
			});
			if (matched) return current;
			current = current.parentEl;
		}
		return null;
	}

	querySelector() {
		return null;
	}
}

const fakeBody = new FakeEl('body');
global.document = {
	body: fakeBody,
	listeners: {},
	addEventListener(type, callback) {
		(this.listeners[type] = this.listeners[type] || []).push(callback);
	},
	createElement(tag) {
		return new FakeEl(tag);
	},
	getSelection() {
		return { isCollapsed: true, rangeCount: 0 };
	},
};

global.window = {
	innerWidth: 1200,
	innerHeight: 800,
	listeners: {},
	addEventListener(type, callback) {
		(this.listeners[type] = this.listeners[type] || []).push(callback);
	},
	removeEventListener() {},
	getSelection() {
		return { isCollapsed: true, rangeCount: 0 };
	},
};

/* ------------------------------------------------------------- fake obsidian */

const notices = [];
const settingsInstances = [];

class Notice {
	constructor(message) {
		notices.push(String(message));
	}
	setMessage(message) {
		notices.push(String(message));
	}
	hide() {}
}

class TFile {
	constructor(filePath) {
		this.path = filePath;
		this.name = filePath.split('/').pop();
		this.basename = this.name.replace(/\.[^.]+$/, '');
		this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
		this.content = '';
	}
}

class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest || { version: '0.1.0', id: 'ai-local-translator' };
		this.data = null;
		this.commands = [];
		this.domEvents = [];
	}

	async loadData() {
		return this.data;
	}

	async saveData(data) {
		this.data = data;
	}

	addSettingTab(tab) {
		this.settingTab = tab;
	}

	addCommand(command) {
		this.commands.push(command);
	}

	addRibbonIcon() {}

	registerDomEvent(element, type, callback) {
		this.domEvents.push({ element, type, callback });
	}

	registerEvent() {}

	registerInterval() {}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = new FakeEl('div');
	}
}

class Component {
	constructor() {
		this.inputEl = new FakeEl('input');
		this.value = '';
	}

	setValue(value) {
		this.value = value;
		return this;
	}

	setPlaceholder() {
		return this;
	}

	onChange(callback) {
		this.changeHandler = callback;
		return this;
	}

	setLimits() {
		return this;
	}

	setDynamicTooltip() {
		return this;
	}

	setButtonText() {
		return this;
	}

	setCta() {
		return this;
	}

	setIcon() {
		return this;
	}

	setTooltip() {
		return this;
	}

	setDisabled() {
		return this;
	}

	setWarning() {
		return this;
	}

	onClick(callback) {
		this.clickHandler = callback;
		return this;
	}

	addOption() {
		return this;
	}

	selectEl = new FakeEl('select');
}

class Setting {
	constructor(containerEl) {
		this.containerEl = containerEl;
		this.components = [];
		settingsInstances.push(this);
	}

	setName(name) {
		this.name = name;
		return this;
	}

	setDesc(desc) {
		this.desc = desc;
		return this;
	}

	setHeading() {
		this.heading = true;
		return this;
	}

	_add(kind, callback) {
		const component = new Component();
		component.kind = kind;
		this.components.push(component);
		callback(component);
		return this;
	}

	addText(callback) {
		return this._add('text', callback);
	}

	addTextArea(callback) {
		return this._add('textarea', callback);
	}

	addToggle(callback) {
		return this._add('toggle', callback);
	}

	addDropdown(callback) {
		return this._add('dropdown', callback);
	}

	addSlider(callback) {
		return this._add('slider', callback);
	}

	addButton(callback) {
		return this._add('button', callback);
	}

	addExtraButton(callback) {
		return this._add('extra', callback);
	}
}

/* ------------------------------------------------------------- fake app/vault */

const vaultFiles = new Map();
const vaultFolders = new Set();

const vault = {
	async read(file) {
		return file.content;
	},
	async modify(file, content) {
		file.content = content;
	},
	async process(file, fn) {
		file.content = fn(file.content);
		return file.content;
	},
	async create(filePath, content) {
		const file = new TFile(filePath);
		file.content = content;
		vaultFiles.set(filePath, file);
		return file;
	},
	async createFolder(folderPath) {
		vaultFolders.add(folderPath);
	},
	getAbstractFileByPath(filePath) {
		if (vaultFiles.has(filePath)) return vaultFiles.get(filePath);
		if (vaultFolders.has(filePath)) return { path: filePath, isFolder: true };
		return null;
	},
};

const app = {
	vault,
	workspace: {
		on() {
			return {};
		},
		getActiveViewOfType() {
			return null;
		},
		getMostRecentLeaf() {
			return null;
		},
		activeLeaf: null,
	},
	metadataCache: {
		fileToLinktext() {
			return 'note';
		},
	},
};

const mockObsidian = {
	MarkdownView: class MarkdownView {},
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath(value) {
		return String(value)
			.replace(/\\/g, '/')
			.replace(/^\/+|\/+$/g, '');
	},
	requestUrl: async (options) => {
		httpCalls.push(options);
		if (typeof httpResponder !== 'function') throw new Error('no responder configured');
		return httpResponder(options);
	},
	setIcon() {},
};

/* ------------------------------------------------------------------ http stub */

let httpCalls = [];
let httpResponder = null;

function respondWith(response) {
	httpResponder = async () => response;
}

/* --------------------------------------------------------------------- loader */

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === 'obsidian') return mockObsidian;
	return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require(path.join(__dirname, '..', 'main.js'));

/* --------------------------------------------------------------------- runner */

let passed = 0;
const failures = [];

async function test(name, fn) {
	httpCalls = [];
	notices.length = 0;
	try {
		await fn();
		passed += 1;
		process.stdout.write(`ok   ${name}\n`);
	} catch (err) {
		failures.push({ name, err });
		process.stdout.write(`FAIL ${name}\n     ${err && err.message}\n`);
	}
}

async function createPlugin() {
	const plugin = new PluginClass(app, { version: '0.1.0', id: 'ai-local-translator' });
	await plugin.onload();
	plugin.settings.baseUrl = 'http://127.0.0.1:1234/v1';
	plugin.settings.model = 'qwen2.5-7b-instruct';
	plugin.settings.provider = 'auto';
	plugin.settings.stream = false;
	return plugin;
}

/* ---------------------------------------------------------------------- tests */

(async () => {
	await test('loads with defaults and registers commands', async () => {
		const plugin = await createPlugin();
		assert.equal(plugin.commands.length, 3);
		assert.equal(plugin.settings.targetLang, '中文');
		assert.equal(plugin.settings.vocabPath, '生词本.md');
	});

	await test('OpenAI compatible request: URL, model, messages', async () => {
		const plugin = await createPlugin();
		respondWith({
			status: 200,
			json: { choices: [{ message: { content: '你好，世界' } }] },
			text: '',
		});
		const result = await plugin.translate('Hello, world.');
		assert.equal(result, '你好，世界');

		assert.equal(httpCalls.length, 1);
		const call = httpCalls[0];
		assert.equal(call.url, 'http://127.0.0.1:1234/v1/chat/completions');
		const body = JSON.parse(call.body);
		assert.equal(body.model, 'qwen2.5-7b-instruct');
		assert.equal(body.stream, false);
		assert.equal(body.messages.length, 2);
		assert.equal(body.messages[0].role, 'system');
		assert.match(body.messages[0].content, /中文/);
		assert.equal(body.messages[1].content, 'Hello, world.');
	});

	await test('Ollama native endpoint and response shape', async () => {
		const plugin = await createPlugin();
		plugin.settings.baseUrl = 'http://127.0.0.1:11434';
		respondWith({ status: 200, json: { message: { content: '放弃' } }, text: '' });

		const result = await plugin.translate('abandon');
		assert.equal(result, '放弃');
		assert.equal(httpCalls[0].url, 'http://127.0.0.1:11434/api/chat');
		const body = JSON.parse(httpCalls[0].body);
		assert.equal(body.stream, false);
		assert.ok(body.options, 'Ollama body should carry options.temperature');
	});

	await test('explicit /v1 on Ollama port stays OpenAI compatible', async () => {
		const plugin = await createPlugin();
		plugin.settings.baseUrl = 'http://127.0.0.1:11434/v1';
		respondWith({ status: 200, json: { choices: [{ message: { content: 'ok' } }] }, text: '' });
		await plugin.translate('hi');
		assert.equal(httpCalls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
	});

	await test('HTTP 404 produces a readable error', async () => {
		const plugin = await createPlugin();
		respondWith({ status: 404, json: { error: { message: 'model not found' } }, text: '' });
		await assert.rejects(() => plugin.translate('hello'), (err) => {
			assert.match(err.message, /404/);
			assert.match(err.message, /model not found/);
			return true;
		});
	});

	await test('model list parsing for OpenAI and Ollama', async () => {
		const plugin = await createPlugin();
		respondWith({ status: 200, json: { data: [{ id: 'a' }, { id: 'b' }] }, text: '' });
		assert.deepEqual(await plugin.fetchModels(), ['a', 'b']);

		plugin.settings.baseUrl = 'http://127.0.0.1:11434';
		respondWith({ status: 200, json: { models: [{ name: 'qwen2.5:7b' }] }, text: '' });
		assert.deepEqual(await plugin.fetchModels(), ['qwen2.5:7b']);
	});

	await test('word vs sentence instructions differ', async () => {
		const plugin = await createPlugin();
		const wordPrompt = plugin.buildMessages('abandon')[0].content;
		assert.match(wordPrompt, /单词或短语/);

		const sentencePrompt = plugin.buildMessages(
			'He decided to abandon the plan after the first failure.'
		)[0].content;
		assert.match(sentencePrompt, /连续文本/);
	});

	await test('long selections are truncated to maxChars', async () => {
		const plugin = await createPlugin();
		plugin.settings.maxChars = 200;
		respondWith({ status: 200, json: { choices: [{ message: { content: 'x' } }] }, text: '' });
		await plugin.translate('a'.repeat(500));
		const body = JSON.parse(httpCalls[0].body);
		assert.equal(body.messages[1].content.length, 200);
		assert.ok(notices.some((message) => message.includes('截断')));
	});

	await test('vocabulary entry is a callout with meaning, context and source', async () => {
		const plugin = await createPlugin();
		const outcome = await plugin.addToVocabulary({
			term: 'abandon',
			translation: 'vt. 放弃；抛弃',
			context: 'He abandoned the plan.',
			file: { path: 'notes/a.md', basename: 'a' },
			page: null,
		});
		assert.equal(outcome.ok, true);

		const file = vaultFiles.get('生词本.md');
		assert.ok(file, 'vocabulary note should be created');
		assert.match(file.content, /^---\ntags:\n {2}- vocabulary\n---/);
		assert.match(file.content, /> \[!tip\] abandon/);
		assert.match(file.content, /\*\*释义\*\*：vt\. 放弃；抛弃/);
		assert.match(file.content, /\*\*语境\*\*：He abandoned the plan\./);
		assert.match(file.content, /\*\*来源\*\*：\[\[note\]\]/);
		assert.match(file.content, /# 生词本/);
	});

	await test('duplicate vocabulary entries are rejected', async () => {
		const plugin = await createPlugin();
		const payload = {
			term: 'abet',
			translation: '教唆',
			context: '',
			file: null,
			page: null,
		};
		assert.equal((await plugin.addToVocabulary(payload)).ok, true);
		const second = await plugin.addToVocabulary(payload);
		assert.equal(second.ok, false);
		assert.match(second.message, /已经有/);
	});

	await test('vocabulary path with a folder creates the folder first', async () => {
		const plugin = await createPlugin();
		plugin.settings.vocabPath = '语言/生词本.md';
		const outcome = await plugin.addToVocabulary({
			term: 'lucid',
			translation: 'adj. 清晰的',
			context: '',
			file: null,
			page: null,
		});
		assert.equal(outcome.ok, true);
		assert.ok(vaultFolders.has('语言'));
		assert.ok(vaultFiles.has('语言/生词本.md'));
	});

	await test('PDF selection adds a page marker to the source', async () => {
		const plugin = await createPlugin();
		await plugin.addToVocabulary({
			term: 'heuristic',
			translation: 'n. 启发式方法',
			context: '',
			file: { path: 'papers/x.pdf', basename: 'x' },
			page: '12',
		});
		const file = vaultFiles.get('生词本.md');
		assert.match(file.content, /\[\[note\]\] · p\.12 · \d{4}-\d{2}-\d{2}/);
	});

	await test('settings tab renders without throwing', async () => {
		const plugin = await createPlugin();
		const TabClass = plugin.settingTab.constructor;
		const tab = new TabClass(app, plugin);
		tab.display();
		assert.ok(settingsInstances.length > 20, 'settings tab should build many rows');
		assert.ok(settingsInstances.some((setting) => setting.name === 'Base URL'));
		assert.ok(settingsInstances.some((setting) => setting.name === '生词本路径'));
	});

	await test('streaming falls back to a plain request when fetch is unavailable', async () => {
		const plugin = await createPlugin();
		plugin.settings.stream = true;
		const originalFetch = global.fetch;
		global.fetch = undefined;
		respondWith({ status: 200, json: { choices: [{ message: { content: '回退成功' } }] }, text: '' });
		try {
			const result = await plugin.translate('fallback please');
			assert.equal(result, '回退成功');
			assert.equal(httpCalls.length, 1);
		} finally {
			global.fetch = originalFetch;
		}
	});

	await test('streaming parses OpenAI SSE deltas', async () => {
		const plugin = await createPlugin();
		plugin.settings.stream = true;
		const originalFetch = global.fetch;
		const tokens = [];
		global.fetch = async () => {
			const chunks = [
				'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
				'data: [DONE]\n\n',
			];
			let index = 0;
			const encoder = new TextEncoder();
			return {
				ok: true,
				status: 200,
				body: {
					getReader() {
						return {
							async read() {
								if (index >= chunks.length) return { done: true, value: undefined };
								const value = encoder.encode(chunks[index]);
								index += 1;
								return { done: false, value };
							},
						};
					},
				},
			};
		};
		try {
			const result = await plugin.translate('hi', { onToken: (piece) => tokens.push(piece) });
			assert.equal(result, '你好');
			assert.deepEqual(tokens, ['你', '好']);
			assert.equal(httpCalls.length, 0, 'streaming must not fall back when it works');
		} finally {
			global.fetch = originalFetch;
		}
	});

	await test('streaming parses Ollama NDJSON', async () => {
		const plugin = await createPlugin();
		plugin.settings.stream = true;
		plugin.settings.baseUrl = 'http://127.0.0.1:11434';
		const originalFetch = global.fetch;
		global.fetch = async () => {
			const chunks = [
				'{"message":{"content":"放"},"done":false}\n',
				'{"message":{"content":"弃"},"done":false}\n',
				'{"done":true}\n',
			];
			let index = 0;
			const encoder = new TextEncoder();
			return {
				ok: true,
				status: 200,
				body: {
					getReader() {
						return {
							async read() {
								if (index >= chunks.length) return { done: true, value: undefined };
								const value = encoder.encode(chunks[index]);
								index += 1;
								return { done: false, value };
							},
						};
					},
				},
			};
		};
		try {
			assert.equal(await plugin.translate('abandon'), '放弃');
		} finally {
			global.fetch = originalFetch;
		}
	});

	await test('markdown selection: text and context come from the editor', async () => {
		const plugin = await createPlugin();
		const containerEl = new FakeEl('div');
		const anchor = containerEl.createDiv({ cls: 'cm-line' });
		anchor.textContent = 'He abandoned the plan.';

		const editor = {
			getSelection: () => 'abandoned',
			getCursor: () => ({ line: 0, ch: 3 }),
			getLine: () => 'He abandoned the plan.',
		};

		app.workspace.getActiveViewOfType = () => ({
			containerEl,
			editor,
			file: { path: 'notes/a.md', basename: 'a' },
			getMode: () => 'source',
		});
		global.window.getSelection = () => ({
			isCollapsed: false,
			rangeCount: 1,
			toString: () => 'abandoned',
			anchorNode: anchor,
			getRangeAt: () => ({
				getClientRects: () => [{ left: 10, top: 20, right: 80, bottom: 36, width: 70, height: 16 }],
				getBoundingClientRect: () => ({ left: 10, top: 20, right: 80, bottom: 36, width: 70, height: 16 }),
			}),
		});

		const ctx = plugin.getSelection();
		assert.ok(ctx, 'selection should be recognised');
		assert.equal(ctx.text, 'abandoned');
		assert.equal(ctx.context, 'He abandoned the plan.');
		assert.equal(ctx.mode, 'markdown');
		assert.equal(ctx.file.basename, 'a');
	});

	await test('PDF selection: page number is captured', async () => {
		const plugin = await createPlugin();
		const containerEl = new FakeEl('div');
		const pageEl = containerEl.createDiv({ cls: 'pdf-page' });
		pageEl.attrs['data-page-number'] = '7';
		const anchor = pageEl.createDiv({ cls: 'span' });

		app.workspace.getActiveViewOfType = () => null;
		app.workspace.getMostRecentLeaf = () => ({
			view: {
				getViewType: () => 'pdf',
				containerEl,
				file: { path: 'papers/x.pdf', basename: 'x' },
			},
		});
		global.window.getSelection = () => ({
			isCollapsed: false,
			rangeCount: 1,
			toString: () => 'heuristic search',
			anchorNode: anchor,
			getRangeAt: () => ({
				getClientRects: () => [{ left: 0, top: 0, right: 50, bottom: 10, width: 50, height: 10 }],
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 50, bottom: 10, width: 50, height: 10 }),
			}),
		});

		const ctx = plugin.getSelection();
		assert.ok(ctx, 'pdf selection should be recognised');
		assert.equal(ctx.mode, 'pdf');
		assert.equal(ctx.page, '7');
		assert.equal(ctx.text, 'heuristic search');
	});

	await test('streaming works against a real SSE server', async () => {
		assert.equal(typeof global.fetch, 'function', 'node 18+ provides fetch');
		const http = require('node:http');
		const seen = {};
		const server = http.createServer((req, res) => {
			seen.url = req.url;
			seen.body = '';
			req.on('data', (chunk) => {
				seen.body += chunk;
			});
			req.on('end', () => {
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.write('data: {"choices":[{"delta":{"content":"流"}}]}\n\n');
				res.write('data: {"choices":[{"delta":{"content":"式"}}]}\n\n');
				res.end('data: [DONE]\n\n');
			});
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;

		try {
			const plugin = await createPlugin();
			plugin.settings.baseUrl = `http://127.0.0.1:${port}/v1`;
			plugin.settings.stream = true;
			const tokens = [];
			const result = await plugin.translate('hello', { onToken: (piece) => tokens.push(piece) });
			assert.equal(result, '流式');
			assert.deepEqual(tokens, ['流', '式']);
			assert.equal(seen.url, '/v1/chat/completions');
			assert.equal(JSON.parse(seen.body).model, 'qwen2.5-7b-instruct');
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	await test('non-streaming request over real HTTP keeps UTF-8 intact', async () => {
		const http = require('node:http');
		const server = http.createServer((req, res) => {
			let raw = '';
			req.on('data', (chunk) => {
				raw += chunk;
			});
			req.on('end', () => {
				const body = JSON.parse(raw);
				const payload = JSON.stringify({
					choices: [{ message: { content: `中文 ✓ ${body.messages[1].content}` } }],
				});
				res.writeHead(200, {
					'Content-Type': 'application/json; charset=utf-8',
					'Content-Length': Buffer.byteLength(payload),
				});
				res.end(payload);
			});
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;

		httpResponder = async (options) => {
			const response = await global.fetch(options.url, {
				method: options.method,
				headers: options.headers,
				body: options.body,
			});
			const text = await response.text();
			let json = null;
			try {
				json = JSON.parse(text);
			} catch (err) {
				json = null;
			}
			return { status: response.status, json, text };
		};

		try {
			const plugin = await createPlugin();
			plugin.settings.baseUrl = `http://127.0.0.1:${port}/v1`;
			const result = await plugin.translate('abandon');
			assert.equal(result, '中文 ✓ abandon');
		} finally {
			httpResponder = null;
			await new Promise((resolve) => server.close(resolve));
		}
	});

	await test('custom headers and API key are merged into the request', async () => {
		const plugin = await createPlugin();
		plugin.settings.apiKey = 'secret-key';
		plugin.settings.customHeaders = 'x-opencode-session: ses_test\n# a comment line\nX-Route: go';
		respondWith({ status: 200, json: { choices: [{ message: { content: 'ok' } }] }, text: '' });
		await plugin.translate('hi');

		const headers = httpCalls[0].headers;
		assert.equal(headers.Authorization, 'Bearer secret-key');
		assert.equal(headers['x-opencode-session'], 'ses_test');
		assert.equal(headers['X-Route'], 'go');
	});

	/* ---------------------------------------------------------------- report */

	process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
	if (failures.length) process.exitCode = 1;
})().catch((err) => {
	process.stderr.write(`harness crashed: ${err && err.stack ? err.stack : err}\n`);
	process.exitCode = 1;
});
