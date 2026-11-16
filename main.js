/*
 * AI Local Translator — an Obsidian plugin.
 *
 * Select text in a Markdown note or a PDF, translate it with a model that runs
 * on your own machine (Ollama, LM Studio, vLLM, llama.cpp server, one-api, ...),
 * and push the result into a vocabulary note with one click.
 *
 * This file is shipped as plain CommonJS JavaScript on purpose: the plugin has
 * no build step, so `main.js` is both the source and the distributable.
 */

'use strict';

const {
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
	requestUrl,
	setIcon,
} = require('obsidian');

/* -------------------------------------------------------------------------- */
/* Constants and defaults                                                     */
/* -------------------------------------------------------------------------- */

const PROVIDER_AUTO = 'auto';
const PROVIDER_OPENAI = 'openai';
const PROVIDER_OLLAMA = 'ollama';

const DEFAULT_SYSTEM_PROMPT = [
	'你是一位严谨的双语译者。请把用户提供的内容翻译成{{targetLang}}。',
	'规则：',
	'1. 只输出译文，不要复述原文，不要添加「译文：」之类的引导语。',
	'2. 保留原文中的 Markdown 标记、代码、公式、专有名词与数字。',
	'3. 术语采用通行译法；不确定的专有名词保留原文并在括号中给出中文。',
].join('\n');

const DEFAULT_SETTINGS = {
	// Model service
	provider: PROVIDER_AUTO,
	baseUrl: 'http://127.0.0.1:11434',
	apiKey: '',
	customHeaders: '',
	model: '',
	temperature: 0.1,
	timeoutMs: 60000,
	stream: false,

	// Translation behaviour
	targetLang: '中文',
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	autoTranslateOnSelect: false,
	showTriggerButton: true,
	translateInMarkdown: true,
	translateInPdf: true,
	maxChars: 4000,

	// Vocabulary note
	vocabPath: '生词本.md',
	vocabCallout: 'tip',
	vocabIncludeContext: true,
	vocabContextChars: 160,
	vocabIncludeSource: true,
	vocabDedup: true,
	vocabAutoCreate: true,
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function pad2(value) {
	return String(value).padStart(2, '0');
}

function formatDateTime(date) {
	const d = date instanceof Date ? date : new Date();
	return (
		`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
		` ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
	);
}

function collapseWhitespace(input) {
	return String(input == null ? '' : input)
		.replace(/\s+/g, ' ')
		.trim();
}

function truncate(input, max) {
	const text = String(input == null ? '' : input);
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

/**
 * A very small heuristic: is the selection a dictionary-style headword
 * (a word or a short phrase) rather than a sentence/paragraph?
 */
function isLikelyWord(text) {
	const t = collapseWhitespace(text);
	if (!t || t.length > 48) return false;
	if (/[。！？!?;；:：]/.test(t)) return false;
	if (/[，,、]/.test(t)) return false;
	const parts = t.split(' ').filter(Boolean);
	return parts.length <= 3;
}

function abortError() {
	const err = new Error('已取消');
	err.name = 'AbortError';
	return err;
}

function withTimeout(promise, timeoutMs, message) {
	let timer = null;
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(message)), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/**
 * Parse "Header-Name: value" lines into an object. Used for gateways that need
 * extra headers (session ids, routing hints, ...).
 */
function parseHeaderLines(raw) {
	const headers = {};
	String(raw == null ? '' : raw)
		.split('\n')
		.forEach((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) return;
			const index = trimmed.indexOf(':');
			if (index <= 0) return;
			const name = trimmed.slice(0, index).trim();
			const value = trimmed.slice(index + 1).trim();
			if (name) headers[name] = value;
		});
	return headers;
}

/* -------------------------------------------------------------------------- */
/* HTTP / model service layer                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turn the user's base URL into concrete endpoints for either the OpenAI
 * compatible API or the native Ollama API.
 */
function buildEndpoint(settings) {
	const raw = String(settings.baseUrl || '').trim();
	if (!raw) {
		throw new Error('请先在插件设置里填写模型服务的 Base URL，例如 http://127.0.0.1:11434');
	}

	let base = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
	base = base.replace(/\/+$/, '');
	base = base.replace(/\/(chat\/completions|completions|api\/chat|api\/generate)$/i, '');
	base = base.replace(/\/+$/, '');

	let kind = settings.provider || PROVIDER_AUTO;
	if (kind !== PROVIDER_OLLAMA && kind !== PROVIDER_OPENAI) {
		kind = PROVIDER_AUTO;
	}
	if (kind === PROVIDER_AUTO) {
		if (/\/v\d+$/i.test(base)) {
			// An explicit /v1 suffix means the OpenAI compatible endpoint, even on
			// Ollama's port 11434.
			kind = PROVIDER_OPENAI;
		} else if (/:11434(\/|$)/.test(base) || /\/api$/.test(base) || /ollama/i.test(base)) {
			kind = PROVIDER_OLLAMA;
		} else {
			kind = PROVIDER_OPENAI;
		}
	}

	let chatUrl;
	let modelsUrl;
	if (kind === PROVIDER_OLLAMA) {
		const root = base.replace(/\/api$/i, '').replace(/\/v\d+$/i, '');
		chatUrl = `${root}/api/chat`;
		modelsUrl = `${root}/api/tags`;
	} else {
		const versioned = /\/v\d+$/i.test(base);
		chatUrl = versioned ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
		modelsUrl = versioned ? `${base}/models` : `${base}/v1/models`;
	}

	const headers = { 'Content-Type': 'application/json' };
	const apiKey = String(settings.apiKey || '').trim();
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	Object.assign(headers, parseHeaderLines(settings.customHeaders));

	return { kind, baseUrl: base, chatUrl, modelsUrl, headers };
}

function explainHttpError(res, url) {
	let detail = '';
	try {
		const body = res && res.json;
		if (body) {
			detail =
				(body.error && (body.error.message || body.error)) ||
				body.message ||
				'';
		}
	} catch (err) {
		// not JSON, fall through to the raw text
	}
	if (!detail) {
		try {
			detail = String((res && res.text) || '').slice(0, 300);
		} catch (err) {
			detail = '';
		}
	}
	const status = res && res.status;
	let hint = '';
	if (status === 404) {
		hint = '（路径可能不对：OpenAI 兼容服务通常需要 /v1，Ollama 用根地址）';
	} else if (status === 401 || status === 403) {
		hint = '（鉴权失败，检查 API Key）';
	} else if (status === 500 || status === 503) {
		hint = '（模型可能还没加载完成）';
	}
	return `模型服务返回 HTTP ${status}${hint}${detail ? `：${String(detail).slice(0, 300)}` : ''}`;
}

function normalizeRequestError(err, url) {
	if (err && typeof err.status === 'number') {
		return new Error(explainHttpError(err, url));
	}
	const raw = err && (err.message || err.error) ? String(err.message || err.error) : String(err);
	if (/Failed to fetch|ERR_CONNECTION_REFUSED|ECONNREFUSED|net::|ENOTFOUND|EAI_AGAIN|NetworkError/i.test(raw)) {
		return new Error(
			`无法连接到 ${url}\n` +
				'请确认本地模型服务已启动，并检查地址/端口是否正确。' +
				`\n原始错误：${raw}`
		);
	}
	return new Error(raw);
}

function extractAssistantText(kind, data) {
	if (!data || typeof data !== 'object') return '';
	if (kind === PROVIDER_OLLAMA) {
		if (data.message && typeof data.message.content === 'string') return data.message.content;
		if (typeof data.response === 'string') return data.response;
		return '';
	}
	const choice = data.choices && data.choices[0];
	if (!choice) return '';
	const content = choice.message ? choice.message.content : choice.text;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && (part.text || (part.type === 'text' && part.text))) || '')
			.join('');
	}
	return '';
}

async function postChat(cfg, messages, opts) {
	const options = opts || {};
	const temperature = typeof options.temperature === 'number' ? options.temperature : 0.1;
	const timeoutMs = options.timeoutMs || 60000;
	const signal = options.signal;

	if (signal && signal.aborted) throw abortError();

	const body =
		cfg.kind === PROVIDER_OLLAMA
			? { model: cfg.model, messages, stream: false, options: { temperature } }
			: { model: cfg.model, messages, temperature, stream: false };

	const request = requestUrl({
		url: cfg.chatUrl,
		method: 'POST',
		headers: cfg.headers,
		contentType: 'application/json',
		body: JSON.stringify(body),
		throw: false,
	});

	let guarded = request;
	if (signal) {
		guarded = Promise.race([
			request,
			new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(abortError()), { once: true });
			}),
		]);
	}

	let res;
	try {
		res = await withTimeout(
			guarded,
			timeoutMs,
			`请求超时（${Math.round(timeoutMs / 1000)} 秒内没有响应）：${cfg.chatUrl}`
		);
	} catch (err) {
		if (err && err.name === 'AbortError') throw err;
		throw normalizeRequestError(err, cfg.chatUrl);
	}

	if (res && res.status >= 400) {
		throw new Error(explainHttpError(res, cfg.chatUrl));
	}

	let data = null;
	try {
		data = res && res.json ? res.json : null;
	} catch (err) {
		data = null;
	}
	if (!data) {
		try {
			data = JSON.parse(String((res && res.text) || ''));
		} catch (err) {
			throw new Error(
				`无法解析模型返回的内容：${truncate((res && res.text) || '', 200)}`
			);
		}
	}

	const text = extractAssistantText(cfg.kind, data);
	if (!text || !String(text).trim()) {
		throw new Error('模型返回了空内容，请检查模型是否已加载，或换一个模型试试');
	}
	return String(text).trim();
}

/** Parse one line of a streaming response (SSE for OpenAI, NDJSON for Ollama). */
function parseStreamLine(line) {
	const trimmed = String(line || '').trim();
	if (!trimmed) return '';
	let payload = trimmed;
	if (payload.startsWith('data:')) {
		payload = payload.slice(5).trim();
		if (!payload || payload === '[DONE]') return '';
	}
	if (!payload.startsWith('{')) return '';
	try {
		const obj = JSON.parse(payload);
		if (obj && obj.choices && obj.choices[0]) {
			const delta = obj.choices[0].delta || {};
			if (typeof delta.content === 'string') return delta.content;
			if (Array.isArray(delta.content)) {
				return delta.content.map((part) => (part && part.text) || '').join('');
			}
			const message = obj.choices[0].message;
			if (message && typeof message.content === 'string') return message.content;
		}
		if (obj && obj.message && typeof obj.message.content === 'string') return obj.message.content;
		if (obj && typeof obj.response === 'string') return obj.response;
	} catch (err) {
		return '';
	}
	return '';
}

/**
 * Streaming variant. Uses `fetch` instead of `requestUrl` because Obsidian's
 * `requestUrl` only resolves once the whole body has arrived. Local servers
 * often need CORS configured for this to work, so callers must treat failures
 * before the first token as "fall back to the non-streaming path".
 */
async function streamChat(cfg, messages, opts) {
	const options = opts || {};
	if (typeof fetch !== 'function') throw new Error('当前环境不支持流式输出');

	const body =
		cfg.kind === PROVIDER_OLLAMA
			? {
					model: cfg.model,
					messages,
					stream: true,
					options: { temperature: options.temperature == null ? 0.1 : options.temperature },
			  }
			: {
					model: cfg.model,
					messages,
					stream: true,
					temperature: options.temperature == null ? 0.1 : options.temperature,
			  };

	const res = await fetch(cfg.chatUrl, {
		method: 'POST',
		headers: cfg.headers,
		body: JSON.stringify(body),
		signal: options.signal,
	});
	if (!res.ok) throw new Error(`模型服务返回 HTTP ${res.status}`);
	if (!res.body) throw new Error('当前环境不支持流式读取');

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';

	const consume = (line) => {
		const piece = parseStreamLine(line);
		if (piece) {
			full += piece;
			if (typeof options.onToken === 'function') options.onToken(piece);
		}
	};

	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		let index = buffer.indexOf('\n');
		while (index >= 0) {
			consume(buffer.slice(0, index));
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf('\n');
		}
	}
	consume(buffer);
	return full;
}

/* -------------------------------------------------------------------------- */
/* Plugin                                                                     */
/* -------------------------------------------------------------------------- */

class AILocalTranslatorPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.triggerEl = null;
		this.popup = null;
		this._lastSelection = null;
		this._selectionTimer = null;
		this._lastAutoText = '';

		this.addSettingTab(new AILocalTranslatorSettingTab(this.app, this));

		this.addRibbonIcon('languages', '翻译选中文本', () => this.translateSelection());

		this.addCommand({
			id: 'translate-selection',
			name: '翻译选中文本',
			callback: () => this.translateSelection(),
		});

		this.addCommand({
			id: 'translate-and-save-selection',
			name: '翻译选中文本并加入生词本',
			callback: () => this.translateAndSaveSelection(),
		});

		this.addCommand({
			id: 'test-model-connection',
			name: '测试本地模型连接',
			callback: async () => {
				try {
					const result = await this.testConnection();
					new Notice(`连接成功（${result.ms} ms）\n${truncate(result.reply, 120)}`, 8000);
				} catch (err) {
					new Notice(`连接失败：${err && err.message ? err.message : err}`, 10000);
				}
			},
		});

		// Capture phase: Obsidian's PDF viewer may stop propagation of its own
		// mouseup, which would hide the selection from a bubbling listener.
		this.registerDomEvent(document, 'mouseup', (evt) => this.onPointerUp(evt), true);
		this.registerDomEvent(document, 'pointerdown', (evt) => this.onPointerDown(evt), true);
		this.registerDomEvent(document, 'keydown', (evt) => {
			if (evt.key === 'Escape') this.closeUI();
		});
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.hideTrigger()));
	}

	onunload() {
		this.closeUI();
		this.hideTrigger();
		if (this.triggerEl) {
			this.triggerEl.remove();
			this.triggerEl = null;
		}
		if (this._selectionTimer) {
			window.clearTimeout(this._selectionTimer);
			this._selectionTimer = null;
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Settings                                                               */
	/* ---------------------------------------------------------------------- */

	async loadSettings() {
		const data = (await this.loadData()) || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async updateSettings(patch) {
		Object.assign(this.settings, patch);
		await this.saveSettings();
	}

	/* ---------------------------------------------------------------------- */
	/* Model access                                                           */
	/* ---------------------------------------------------------------------- */

	getConfig() {
		const endpoint = buildEndpoint(this.settings);
		const model = String(this.settings.model || '').trim();
		if (!model) {
			throw new Error('还没有选择模型：请打开插件设置，填写或检测一个模型名称');
		}
		return {
			kind: endpoint.kind,
			baseUrl: endpoint.baseUrl,
			chatUrl: endpoint.chatUrl,
			modelsUrl: endpoint.modelsUrl,
			headers: endpoint.headers,
			model,
			temperature: this.settings.temperature,
			timeoutMs: this.settings.timeoutMs,
			stream: !!this.settings.stream,
		};
	}

	describeModel() {
		const provider = this.settings.provider === PROVIDER_AUTO ? '自动' : this.settings.provider;
		return `${provider} · ${this.settings.model || '未选择模型'}`;
	}

	buildMessages(text) {
		const target = String(this.settings.targetLang || '中文').trim() || '中文';
		let system = String(this.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT).replace(
			/\{\{targetLang\}\}/g,
			target
		);
		if (isLikelyWord(text)) {
			system +=
				`\n\n当前输入是一个单词或短语：第一行用「词性. 义项1；义项2」的格式给出${target}释义，` +
				'多个义项之间用「；」分隔；必要时再补一句简短说明。不要输出原文、音标或客套话。';
		} else {
			system += `\n\n当前输入是一段连续文本：直接给出${target}译文，不要逐句对照，也不要解释。`;
		}
		return [
			{ role: 'system', content: system },
			{ role: 'user', content: text },
		];
	}

	async translate(rawText, opts) {
		const options = opts || {};
		const cfg = this.getConfig();

		const limit = Math.max(200, Number(this.settings.maxChars) || 4000);
		let text = String(rawText == null ? '' : rawText).trim();
		if (!text) throw new Error('没有可翻译的文本');
		if (text.length > limit) {
			text = text.slice(0, limit);
			new Notice(`选中文本较长，已按设置截断为前 ${limit} 个字符`, 5000);
		}

		const messages = this.buildMessages(text);
		const onToken = typeof options.onToken === 'function' ? options.onToken : null;
		const signal = options.signal;

		if (cfg.stream) {
			let received = false;
			try {
				const streamed = await streamChat(cfg, messages, {
					temperature: cfg.temperature,
					signal,
					onToken: (piece) => {
						received = true;
						if (onToken) onToken(piece);
					},
				});
				if (streamed && streamed.trim()) return streamed.trim();
				throw new Error('模型返回了空内容');
			} catch (err) {
				if (err && err.name === 'AbortError') throw err;
				// If nothing arrived yet, the stream probably failed because of CORS;
				// fall through to the reliable non-streaming request.
				if (received) throw err;
			}
		}

		const result = await postChat(cfg, messages, {
			temperature: cfg.temperature,
			timeoutMs: cfg.timeoutMs,
			signal,
		});
		if (onToken) onToken(result);
		return result;
	}

	async fetchModels() {
		const endpoint = buildEndpoint(this.settings);
		let res;
		try {
			res = await withTimeout(
				requestUrl({
					url: endpoint.modelsUrl,
					method: 'GET',
					headers: endpoint.headers,
					throw: false,
				}),
				15000,
				'读取模型列表超时'
			);
		} catch (err) {
			throw normalizeRequestError(err, endpoint.modelsUrl);
		}
		if (res && res.status >= 400) {
			throw new Error(explainHttpError(res, endpoint.modelsUrl));
		}
		let data = null;
		try {
			data = res && res.json ? res.json : null;
		} catch (err) {
			data = null;
		}
		if (!data) {
			try {
				data = JSON.parse(String((res && res.text) || ''));
			} catch (err) {
				throw new Error('模型列表返回的格式无法解析');
			}
		}

		const names = [];
		if (endpoint.kind === PROVIDER_OLLAMA) {
			(data.models || []).forEach((item) => {
				if (item && item.name) names.push(String(item.name));
			});
		} else {
			(data.data || []).forEach((item) => {
				if (item && item.id) names.push(String(item.id));
			});
		}
		return names;
	}

	async testConnection() {
		const cfg = this.getConfig();
		const started = Date.now();
		const reply = await postChat(
			cfg,
			[{ role: 'user', content: '请用一句话介绍你自己。' }],
			{ temperature: 0.1, timeoutMs: Math.min(Number(cfg.timeoutMs) || 30000, 30000) }
		);
		return { ms: Date.now() - started, reply };
	}

	/* ---------------------------------------------------------------------- */
	/* Selection handling                                                     */
	/* ---------------------------------------------------------------------- */

	getActiveView() {
		const workspace = this.app.workspace;
		let leaf = null;
		if (typeof workspace.getMostRecentLeaf === 'function') {
			leaf = workspace.getMostRecentLeaf();
		}
		if (!leaf) leaf = workspace.activeLeaf;
		return leaf && leaf.view ? leaf.view : null;
	}

	getSelectionRect(sel) {
		try {
			if (sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				const rects = range.getClientRects();
				if (rects && rects.length) return rects[rects.length - 1];
				const box = range.getBoundingClientRect();
				if (box && (box.width || box.height)) return box;
			}
		} catch (err) {
			// ignore
		}
		return null;
	}

	/**
	 * Read the current text selection if it lives inside a Markdown view or a
	 * PDF view, together with a bit of context for the vocabulary note.
	 */
	getSelection() {
		const settings = this.settings;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

		const text = String(sel.toString() || '').replace(/\u00a0/g, ' ').trim();
		if (!text) return null;

		const anchor = sel.anchorNode;
		if (!anchor) return null;
		const anchorEl = anchor.nodeType === 3 ? anchor.parentElement : anchor;
		if (!anchorEl) return null;
		if (anchorEl.closest('.alt-popup, .alt-trigger, .modal, .prompt, .menu')) return null;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView && mdView.containerEl.contains(anchorEl)) {
			if (!settings.translateInMarkdown) return null;
			const mode = mdView.getMode();
			const file = mdView.file || null;
			let selected = text;
			let context = '';

			if (mode === 'source' && mdView.editor) {
				try {
					const editorText = mdView.editor.getSelection();
					if (editorText && editorText.trim()) selected = editorText.trim();
				} catch (err) {
					// ignore
				}
				try {
					const from = mdView.editor.getCursor('from');
					context = String(mdView.editor.getLine(from.line) || '').trim();
				} catch (err) {
					context = '';
				}
			} else {
				try {
					const block = anchorEl.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote');
					if (block) context = collapseWhitespace(block.textContent);
				} catch (err) {
					context = '';
				}
			}

			return {
				text: selected,
				context,
				file,
				mode: 'markdown',
				page: null,
				rect: this.getSelectionRect(sel) || mdView.containerEl.getBoundingClientRect(),
				label: file ? file.basename : '当前笔记',
			};
		}

		const activeView = this.getActiveView();
		if (activeView && typeof activeView.getViewType === 'function' && activeView.getViewType() === 'pdf') {
			if (!settings.translateInPdf) return null;
			const container = activeView.containerEl;
			if (!container || !container.contains(anchorEl)) return null;

			let page = null;
			try {
				const pageEl =
					anchorEl.closest('[data-page-number]') ||
					anchorEl.closest('.pdf-page') ||
					anchorEl.closest('.page');
				if (pageEl) {
					page =
						pageEl.getAttribute('data-page-number') ||
						pageEl.getAttribute('data-page') ||
						null;
				}
			} catch (err) {
				page = null;
			}

			const file = activeView.file || null;
			return {
				text,
				context: '',
				file,
				mode: 'pdf',
				page,
				rect: this.getSelectionRect(sel) || container.getBoundingClientRect(),
				label: file ? file.basename : 'PDF',
			};
		}

		return null;
	}

	onPointerUp(evt) {
		if (!evt || evt.button !== 0) return;
		const target = evt.target;
		if (target && target.closest && target.closest('.alt-popup, .alt-trigger')) return;

		if (this._selectionTimer) window.clearTimeout(this._selectionTimer);
		this._selectionTimer = window.setTimeout(() => {
			this._selectionTimer = null;
			this.updateSelectionUi();
		}, 10);
	}

	onPointerDown(evt) {
		if (!this.popup) return;
		const target = evt && evt.target;
		if (target && this.popup.contains(target)) return;
		this.closeUI();
	}

	updateSelectionUi() {
		const ctx = this.getSelection();
		if (!ctx) {
			this.hideTrigger();
			return;
		}

		if (this.settings.autoTranslateOnSelect) {
			this.hideTrigger();
			if (ctx.text === this._lastAutoText && this.popup) return;
			this._lastAutoText = ctx.text;
			this.openPopup(ctx);
			return;
		}

		if (this.settings.showTriggerButton) this.showTrigger(ctx);
		else this.hideTrigger();
	}

	translateSelection() {
		const ctx = this.getSelection();
		if (!ctx) {
			new Notice('没有选中文本，或选区不在当前 Markdown / PDF 视图中');
			return;
		}
		this.hideTrigger();
		this.openPopup(ctx);
	}

	async translateAndSaveSelection() {
		const ctx = this.getSelection();
		if (!ctx) {
			new Notice('没有选中文本，或选区不在当前 Markdown / PDF 视图中');
			return;
		}
		this.hideTrigger();
		this.openPopup(ctx, { saveWhenDone: true });
	}

	/* ---------------------------------------------------------------------- */
	/* Floating trigger button                                                */
	/* ---------------------------------------------------------------------- */

	ensureTriggerEl() {
		if (this.triggerEl) return this.triggerEl;

		const el = document.body.createDiv({ cls: 'alt-trigger' });
		el.style.display = 'none';
		setIcon(el, 'languages');
		el.setAttribute('aria-label', '翻译选中文本');
		el.addEventListener('pointerdown', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
		});
		el.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			const ctx = this._lastSelection;
			this.hideTrigger();
			if (ctx) this.openPopup(ctx);
		});

		this.triggerEl = el;
		return el;
	}

	showTrigger(ctx) {
		this._lastSelection = ctx;
		const el = this.ensureTriggerEl();
		const size = 26;
		const rect = ctx.rect;
		let left = rect ? rect.right + 8 : window.innerWidth / 2;
		let top = rect ? rect.bottom + 8 : window.innerHeight / 2;
		left = clamp(left, 8, window.innerWidth - size - 8);
		top = clamp(top, 8, window.innerHeight - size - 8);
		el.style.left = `${Math.round(left)}px`;
		el.style.top = `${Math.round(top)}px`;
		el.style.display = 'flex';
	}

	hideTrigger() {
		if (this.triggerEl) this.triggerEl.style.display = 'none';
	}

	/* ---------------------------------------------------------------------- */
	/* Popup                                                                  */
	/* ---------------------------------------------------------------------- */

	openPopup(ctx, opts) {
		const options = opts || {};
		this.closeUI();
		this.popup = new AltPopup(this, ctx, options);
		this.popup.show();
	}

	onPopupClosed(popup) {
		if (this.popup === popup) this.popup = null;
		if (this._lastAutoText && !this.popup) this._lastAutoText = '';
	}

	closeUI() {
		if (this.popup) {
			const popup = this.popup;
			this.popup = null;
			popup.close();
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Vocabulary note                                                        */
	/* ---------------------------------------------------------------------- */

	buildSourceLabel(file, page) {
		const parts = [];
		if (file) {
			let link = file.basename;
			try {
				link = this.app.metadataCache.fileToLinktext(file, file.path, true) || link;
			} catch (err) {
				link = file.basename;
			}
			parts.push(`[[${link}]]`);
		}
		if (page) parts.push(`p.${page}`);
		parts.push(formatDateTime());
		return parts.join(' · ');
	}

	buildVocabEntry(payload) {
		const settings = this.settings;
		const callout =
			String(settings.vocabCallout || 'tip')
				.toLowerCase()
				.replace(/[^a-z]/g, '') || 'tip';
		const title = collapseWhitespace(payload.term).slice(0, 60) || '生词';

		const lines = [`> [!${callout}] ${title}`];

		const meaning = collapseWhitespace(payload.translation).slice(0, 600);
		if (meaning) lines.push(`> **释义**：${meaning}`);

		const contextText = collapseWhitespace(payload.context || '').slice(
			0,
			Math.max(20, Number(settings.vocabContextChars) || 160)
		);
		if (settings.vocabIncludeContext && contextText && contextText !== title) {
			lines.push(`> **语境**：${contextText}`);
		}

		if (settings.vocabIncludeSource) {
			const source = this.buildSourceLabel(payload.file, payload.page);
			if (source) lines.push(`> **来源**：${source}`);
		}

		return lines.join('\n');
	}

	hasVocabEntry(content, term) {
		const needle = collapseWhitespace(term).slice(0, 60).toLowerCase();
		if (!needle) return false;
		return String(content || '')
			.split('\n')
			.some((line) => line.trimStart().startsWith('> [') && line.toLowerCase().includes(needle));
	}

	async addToVocabulary(payload) {
		const settings = this.settings;
		const rawPath = String(settings.vocabPath || '生词本.md').trim() || '生词本.md';
		const path = normalizePath(rawPath);
		const entry = this.buildVocabEntry(payload);

		const existing = this.app.vault.getAbstractFileByPath(path);

		if (existing instanceof TFile) {
			const content = await this.app.vault.read(existing);
			if (settings.vocabDedup && this.hasVocabEntry(content, payload.term)) {
				return {
					ok: false,
					message: `生词本里已经有「${truncate(collapseWhitespace(payload.term), 20)}」了`,
				};
			}
			const next = `${content.replace(/\s+$/, '')}\n\n${entry}\n`;
			await this.app.vault.modify(existing, next);
			return { ok: true };
		}

		if (existing) {
			return { ok: false, message: `生词本路径被一个文件夹占用了：${path}` };
		}

		if (!settings.vocabAutoCreate) {
			return { ok: false, message: `生词本文件不存在：${path}` };
		}

		const folder = path.split('/').slice(0, -1).join('/');
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			try {
				await this.app.vault.createFolder(folder);
			} catch (err) {
				// the folder may have been created concurrently, ignore
			}
		}

		const header = '---\ntags:\n  - vocabulary\n---\n\n# 生词本\n\n';
		await this.app.vault.create(path, `${header}${entry}\n`);
		return { ok: true };
	}
}

/* -------------------------------------------------------------------------- */
/* Translation popup                                                          */
/* -------------------------------------------------------------------------- */

class AltPopup {
	constructor(plugin, ctx, options) {
		this.plugin = plugin;
		this.ctx = ctx;
		this.options = options || {};
		this.translation = '';
		this.abortController = null;
		this.closed = false;
		this.saved = false;
		this._build();
	}

	_build() {
		const el = document.body.createDiv({ cls: 'alt-popup' });
		el.setAttribute('role', 'dialog');
		this.el = el;

		const header = el.createDiv({ cls: 'alt-popup-header' });
		this.titleEl = header.createDiv({ cls: 'alt-popup-title', text: 'AI 翻译' });
		this.badgeEl = header.createDiv({ cls: 'alt-popup-badge', text: this.plugin.describeModel() });
		header.createDiv({ cls: 'alt-popup-spacer' });

		const actions = header.createDiv({ cls: 'alt-popup-actions' });
		this.copyBtn = this._iconButton(actions, 'copy', '复制译文', () => this.copy());
		this.saveBtn = this._iconButton(actions, 'book-plus', '加入生词本', () => this.save());
		this.retryBtn = this._iconButton(actions, 'refresh-cw', '重新翻译', () => this.run());
		this.closeBtn = this._iconButton(actions, 'x', '关闭（Esc）', () => this.close());

		this.sourceEl = el.createDiv({ cls: 'alt-popup-source' });
		this.sourceEl.setText(this.ctx.text);

		this.resultEl = el.createDiv({ cls: 'alt-popup-result is-loading' });
		this.resultEl.setText('翻译中…');

		this._enableDrag(header);
	}

	_iconButton(parent, icon, label, onClick) {
		const button = parent.createDiv({ cls: 'alt-icon-btn' });
		button.setAttribute('aria-label', label);
		button.setAttribute('role', 'button');
		setIcon(button, icon);
		button.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			onClick();
		});
		return button;
	}

	show() {
		this.place(this.ctx.rect);
		this.run();
	}

	place(rect) {
		const el = this.el;
		el.style.left = '0px';
		el.style.top = '0px';
		const box = el.getBoundingClientRect();
		const width = box.width || 380;
		const height = box.height || 200;
		const margin = 12;

		let left = rect ? rect.left : (window.innerWidth - width) / 2;
		let top = rect ? rect.bottom + 8 : (window.innerHeight - height) / 2;

		if (rect && top + height > window.innerHeight - margin) {
			top = rect.top - height - 8;
		}

		left = clamp(left, margin, window.innerWidth - width - margin);
		top = clamp(top, margin, window.innerHeight - height - margin);

		el.style.left = `${Math.round(left)}px`;
		el.style.top = `${Math.round(top)}px`;
	}

	_enableDrag(handle) {
		handle.addEventListener('pointerdown', (evt) => {
			if (evt.button !== 0) return;
			if (evt.target && evt.target.closest && evt.target.closest('.alt-icon-btn')) return;
			evt.preventDefault();
			const startX = evt.clientX;
			const startY = evt.clientY;
			const box = this.el.getBoundingClientRect();

			const onMove = (e) => {
				const left = clamp(box.left + (e.clientX - startX), 4, window.innerWidth - box.width - 4);
				const top = clamp(box.top + (e.clientY - startY), 4, window.innerHeight - box.height - 4);
				this.el.style.left = `${Math.round(left)}px`;
				this.el.style.top = `${Math.round(top)}px`;
			};
			const onUp = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		});
		handle.addEventListener('dragstart', (evt) => evt.preventDefault());
	}

	async run() {
		if (this.closed) return;
		if (this.abortController) {
			try {
				this.abortController.abort();
			} catch (err) {
				// ignore
			}
		}
		this.abortController = new AbortController();
		this.translation = '';
		this.saved = false;
		this.resultEl.setAttribute('class', 'alt-popup-result is-loading');
		this.resultEl.setText('翻译中…');
		this.badgeEl.setText(this.plugin.describeModel());
		setIcon(this.saveBtn, 'book-plus');

		const signal = this.abortController.signal;
		try {
			const result = await this.plugin.translate(this.ctx.text, {
				signal,
				onToken: (piece) => {
					if (this.closed) return;
					this.translation += piece;
					this.resultEl.setAttribute('class', 'alt-popup-result');
					this.resultEl.setText(this.translation);
				},
			});
			if (this.closed) return;
			this.translation = result;
			this.resultEl.setAttribute('class', 'alt-popup-result');
			this.resultEl.setText(result);
			if (this.options.saveWhenDone) await this.save();
		} catch (err) {
			if (this.closed || (err && err.name === 'AbortError')) return;
			this.translation = '';
			this.resultEl.setAttribute('class', 'alt-popup-result is-error');
			this.resultEl.setText(err && err.message ? err.message : String(err));
		}
	}

	async copy() {
		if (!this.translation) {
			new Notice('还没有可复制的译文');
			return;
		}
		try {
			await navigator.clipboard.writeText(this.translation);
			new Notice('译文已复制');
		} catch (err) {
			new Notice(`复制失败：${err && err.message ? err.message : err}`);
		}
	}

	async save() {
		if (!this.translation) {
			new Notice('请等翻译完成后再加入生词本');
			return;
		}
		if (this.saved) {
			new Notice('这条已经加入生词本了');
			return;
		}
		try {
			const outcome = await this.plugin.addToVocabulary({
				term: this.ctx.text,
				translation: this.translation,
				context: this.ctx.context,
				file: this.ctx.file,
				page: this.ctx.page,
			});
			if (outcome && outcome.ok) {
				this.saved = true;
				this.saveBtn.setAttribute('aria-label', '已加入生词本');
				setIcon(this.saveBtn, 'check');
				new Notice('已加入生词本');
			} else {
				new Notice((outcome && outcome.message) || '没有加入生词本');
			}
		} catch (err) {
			new Notice(`加入生词本失败：${err && err.message ? err.message : err}`, 8000);
		}
	}

	contains(node) {
		return this.el.contains(node);
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		if (this.abortController) {
			try {
				this.abortController.abort();
			} catch (err) {
				// ignore
			}
		}
		this.el.remove();
		this.plugin.onPopupClosed(this);
	}
}

/* -------------------------------------------------------------------------- */
/* Settings tab                                                               */
/* -------------------------------------------------------------------------- */

class AILocalTranslatorSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.detectedModels = [];
	}

	display() {
		const { containerEl } = this;
		const plugin = this.plugin;
		const settings = plugin.settings;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'AI Local Translator' });
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'划词翻译由本机运行的模型完成，不经过第三方服务器。支持 Ollama、LM Studio、vLLM、llama.cpp server ' +
				'以及任何兼容 OpenAI /chat/completions 的服务。',
		});

		/* ---------------------------------------------------------------- */
		/* Model service                                                     */
		/* ---------------------------------------------------------------- */

		new Setting(containerEl).setName('模型服务').setHeading();

		new Setting(containerEl)
			.setName('接口类型')
			.setDesc('自动会根据地址判断：端口 11434 视为 Ollama，其余视为 OpenAI 兼容接口。')
			.addDropdown((dropdown) => {
				dropdown.addOption(PROVIDER_AUTO, '自动识别');
				dropdown.addOption(PROVIDER_OPENAI, 'OpenAI 兼容（LM Studio / vLLM / one-api）');
				dropdown.addOption(PROVIDER_OLLAMA, 'Ollama 原生 API');
				dropdown.setValue(settings.provider);
				dropdown.onChange(async (value) => {
					await plugin.updateSettings({ provider: value });
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('例如 http://127.0.0.1:11434（Ollama）、http://127.0.0.1:1234/v1（LM Studio）。')
			.addText((text) => {
				text.setPlaceholder('http://127.0.0.1:11434')
					.setValue(settings.baseUrl)
					.onChange(async (value) => {
						await plugin.updateSettings({ baseUrl: value.trim() });
					});
				text.inputEl.style.width = '320px';
			});

		new Setting(containerEl)
			.setName('模型')
			.setDesc('点右侧按钮从本地服务读取已安装的模型。')
			.addDropdown((dropdown) => {
				const options = this.detectedModels.slice();
				if (settings.model && options.indexOf(settings.model) === -1) options.unshift(settings.model);
				if (!options.length) dropdown.addOption('', '（尚未检测到模型）');
				options.forEach((name) => dropdown.addOption(name, name));
				dropdown.setValue(settings.model || '');
				dropdown.onChange(async (value) => {
					await plugin.updateSettings({ model: value });
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon('refresh-cw')
					.setTooltip('获取模型列表')
					.onClick(async () => {
						button.setDisabled(true);
						try {
							const models = await plugin.fetchModels();
							this.detectedModels = models;
							new Notice(
								models.length ? `检测到 ${models.length} 个模型` : '服务返回了空的模型列表',
								4000
							);
							this.display();
						} catch (err) {
							new Notice(`获取模型列表失败：${err && err.message ? err.message : err}`, 10000);
						} finally {
							button.setDisabled(false);
						}
					});
			});

		new Setting(containerEl).setName('模型名称（手动填写）').addText((text) => {
			text.setPlaceholder('如 qwen2.5:7b')
				.setValue(settings.model || '')
				.onChange(async (value) => {
					await plugin.updateSettings({ model: value.trim() });
				});
			text.inputEl.style.width = '320px';
		});

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('本地服务一般不需要；如果用的是带鉴权的代理，请填写。')
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('可留空')
					.setValue(settings.apiKey || '')
					.onChange(async (value) => {
						await plugin.updateSettings({ apiKey: value.trim() });
					});
				text.inputEl.style.width = '320px';
			});

		new Setting(containerEl)
			.setName('自定义请求头')
			.setDesc(
				'每行一个「名称: 值」。有的网关要求额外的路由头，例如 x-opencode-session: ses_dsh_desktop。'
			)
			.addTextArea((area) => {
				area.setPlaceholder('x-opencode-session: ses_dsh_desktop')
					.setValue(settings.customHeaders || '')
					.onChange(async (value) => {
						await plugin.updateSettings({ customHeaders: value });
					});
				area.inputEl.rows = 3;
				area.inputEl.style.width = '100%';
			});

		new Setting(containerEl)
			.setName('温度')
			.setDesc('翻译建议保持在 0 - 0.3 之间。')
			.addSlider((slider) => {
				slider
					.setLimits(0, 1, 0.05)
					.setValue(Number(settings.temperature) || 0)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await plugin.updateSettings({ temperature: value });
					});
			});

		new Setting(containerEl)
			.setName('超时（秒）')
			.setDesc('首次调用时 Ollama 需要把模型读进内存，可以调大一些。')
			.addText((text) => {
				text.setValue(String(Math.round((Number(settings.timeoutMs) || 60000) / 1000)))
					.onChange(async (value) => {
						const seconds = Number(value);
						if (!Number.isFinite(seconds) || seconds < 5) return;
						await plugin.updateSettings({ timeoutMs: Math.round(seconds * 1000) });
					});
				text.inputEl.style.width = '80px';
			});

		new Setting(containerEl)
			.setName('流式输出')
			.setDesc(
				'逐字显示译文，体验更好；但需要本地服务允许来自 Obsidian 的跨域请求' +
					'（Ollama 需设置 OLLAMA_ORIGINS=*）。失败时会自动退回普通请求。'
			)
			.addToggle((toggle) => {
				toggle.setValue(!!settings.stream).onChange(async (value) => {
					await plugin.updateSettings({ stream: value });
				});
			});

		new Setting(containerEl)
			.setName('连接测试')
			.setDesc('用当前配置发一次真实请求。')
			.addButton((button) => {
				button
					.setButtonText('测试')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText('测试中…');
						try {
							const result = await plugin.testConnection();
							new Notice(
								`连接成功（${result.ms} ms）\n${truncate(result.reply, 160)}`,
								10000
							);
						} catch (err) {
							new Notice(`连接失败：${err && err.message ? err.message : err}`, 12000);
						} finally {
							button.setDisabled(false);
							button.setButtonText('测试');
						}
					});
			});

		/* ---------------------------------------------------------------- */
		/* Translation                                                       */
		/* ---------------------------------------------------------------- */

		new Setting(containerEl).setName('翻译').setHeading();

		new Setting(containerEl)
			.setName('目标语言')
			.setDesc('会替换提示词里的 {{targetLang}} 占位符。')
			.addText((text) => {
				text.setPlaceholder('中文')
					.setValue(settings.targetLang)
					.onChange(async (value) => {
						await plugin.updateSettings({ targetLang: value.trim() || '中文' });
					});
				text.inputEl.style.width = '160px';
			});

		new Setting(containerEl)
			.setName('选中即翻译')
			.setDesc('关闭时先在选区旁显示一个翻译按钮，点一下才翻译。')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.autoTranslateOnSelect).onChange(async (value) => {
					await plugin.updateSettings({ autoTranslateOnSelect: value });
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('显示划词按钮')
			.setDesc('在选区右下角显示翻译按钮（选中即翻译开启时无效）。')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.showTriggerButton).onChange(async (value) => {
					await plugin.updateSettings({ showTriggerButton: value });
				});
			});

		new Setting(containerEl)
			.setName('Markdown 划词翻译')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.translateInMarkdown).onChange(async (value) => {
					await plugin.updateSettings({ translateInMarkdown: value });
				});
			});

		new Setting(containerEl)
			.setName('PDF 划词翻译')
			.setDesc('只对带文字层的 PDF 有效；扫描版 PDF 需要先做 OCR。')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.translateInPdf).onChange(async (value) => {
					await plugin.updateSettings({ translateInPdf: value });
				});
			});

		new Setting(containerEl)
			.setName('单次最大字符数')
			.setDesc('超出部分会被截断，避免一次塞得太多。')
			.addText((text) => {
				text.setValue(String(settings.maxChars))
					.onChange(async (value) => {
						const number = Number(value);
						if (!Number.isFinite(number) || number < 200) return;
						await plugin.updateSettings({ maxChars: Math.round(number) });
					});
				text.inputEl.style.width = '100px';
			});

		new Setting(containerEl)
			.setName('提示词')
			.setDesc('支持 {{targetLang}} 占位符。')
			.addTextArea((area) => {
				area.setValue(settings.systemPrompt)
					.onChange(async (value) => {
						await plugin.updateSettings({ systemPrompt: value });
					});
				area.inputEl.rows = 8;
				area.inputEl.style.width = '100%';
			});

		/* ---------------------------------------------------------------- */
		/* Vocabulary                                                        */
		/* ---------------------------------------------------------------- */

		new Setting(containerEl).setName('生词本').setHeading();

		new Setting(containerEl)
			.setName('生词本路径')
			.setDesc('相对 Vault 根目录，例如 生词本.md 或 语言/生词本.md。不存在时自动创建。')
			.addText((text) => {
				text.setPlaceholder('生词本.md')
					.setValue(settings.vocabPath)
					.onChange(async (value) => {
						await plugin.updateSettings({ vocabPath: value.trim() || '生词本.md' });
					});
				text.inputEl.style.width = '320px';
			});

		new Setting(containerEl)
			.setName('Callout 类型')
			.setDesc('每条生词写成一个 callout，例如 tip、note、info、quote。')
			.addText((text) => {
				text.setPlaceholder('tip')
					.setValue(settings.vocabCallout)
					.onChange(async (value) => {
						await plugin.updateSettings({ vocabCallout: value.trim() || 'tip' });
					});
				text.inputEl.style.width = '120px';
			});

		new Setting(containerEl)
			.setName('记录语境')
			.setDesc('把选中内容所在的句子一起存进生词本。')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.vocabIncludeContext).onChange(async (value) => {
					await plugin.updateSettings({ vocabIncludeContext: value });
				});
			});

		new Setting(containerEl)
			.setName('语境长度')
			.setDesc('最多保留多少个字符。')
			.addText((text) => {
				text.setValue(String(settings.vocabContextChars))
					.onChange(async (value) => {
						const number = Number(value);
						if (!Number.isFinite(number) || number < 20) return;
						await plugin.updateSettings({ vocabContextChars: Math.round(number) });
					});
				text.inputEl.style.width = '100px';
			});

		new Setting(containerEl)
			.setName('记录来源')
			.setDesc('写入 [[笔记名]] 和加入时间。')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.vocabIncludeSource).onChange(async (value) => {
					await plugin.updateSettings({ vocabIncludeSource: value });
				});
			});

		new Setting(containerEl)
			.setName('去重')
			.setDesc('同一条生词已经在生词本里时不再重复写入。')
			.addToggle((toggle) => {
				toggle.setValue(!!settings.vocabDedup).onChange(async (value) => {
					await plugin.updateSettings({ vocabDedup: value });
				});
			});

		/* ---------------------------------------------------------------- */
		/* About                                                             */
		/* ---------------------------------------------------------------- */

		new Setting(containerEl).setName('关于').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				`版本 ${this.plugin.manifest.version} · ` +
				'插件本身不联网，所有请求都发往你自己配置的本地模型服务。',
		});
	}
}

module.exports = AILocalTranslatorPlugin;
