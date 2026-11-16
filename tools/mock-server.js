/*
 * A tiny fake model server for trying the plugin UI without a real LLM.
 *
 *   node tools/mock-server.js
 *
 * Then in the plugin settings use:
 *   Base URL: http://127.0.0.1:8787/v1
 *   Model:    mock-model
 *
 * It implements both the OpenAI compatible endpoints and the native Ollama
 * ones, including streaming, so you can test every code path in the plugin.
 */

'use strict';

const http = require('node:http');

const PORT = Number(process.env.MOCK_PORT || 8787);
const MODEL = 'mock-model';

function fakeTranslation(text) {
	const trimmed = String(text || '').trim().slice(0, 200);
	return `【模拟译文】${trimmed.split('').reverse().join('')}`;
}

function readBody(req) {
	return new Promise((resolve) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			try {
				resolve(JSON.parse(raw || '{}'));
			} catch (err) {
				resolve({});
			}
		});
	});
}

function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'Access-Control-Allow-Origin': '*',
	});
	res.end(body);
}

function lastUserMessage(body) {
	const messages = Array.isArray(body.messages) ? body.messages : [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index] && messages[index].role === 'user') {
			return String(messages[index].content || '');
		}
	}
	return '';
}

function streamOpenAi(res, text) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
		'Access-Control-Allow-Origin': '*',
	});
	const pieces = text.match(/[\s\S]{1,4}/g) || [''];
	let index = 0;
	const timer = setInterval(() => {
		if (index >= pieces.length) {
			res.write('data: [DONE]\n\n');
			res.end();
			clearInterval(timer);
			return;
		}
		res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[index] } }] })}\n\n`);
		index += 1;
	}, 20);
}

function streamOllama(res, text) {
	res.writeHead(200, {
		'Content-Type': 'application/x-ndjson',
		'Access-Control-Allow-Origin': '*',
	});
	const pieces = text.match(/[\s\S]{1,4}/g) || [''];
	let index = 0;
	const timer = setInterval(() => {
		if (index >= pieces.length) {
			res.write(`${JSON.stringify({ message: { content: '' }, done: true })}\n`);
			res.end();
			clearInterval(timer);
			return;
		}
		res.write(`${JSON.stringify({ message: { content: pieces[index] }, done: false })}\n`);
		index += 1;
	}, 20);
}

const server = http.createServer(async (req, res) => {
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': '*',
			'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
		});
		res.end();
		return;
	}

	const url = (req.url || '').split('?')[0];
	const body = req.method === 'POST' ? await readBody(req) : {};

	if (req.method === 'GET' && (url === '/v1/models' || url === '/api/tags')) {
		if (url === '/api/tags') {
			sendJson(res, 200, { models: [{ name: MODEL, model: MODEL }] });
		} else {
			sendJson(res, 200, { data: [{ id: MODEL, object: 'model' }] });
		}
		return;
	}

	if (req.method === 'POST' && url === '/v1/chat/completions') {
		const text = fakeTranslation(lastUserMessage(body));
		if (body.stream) {
			streamOpenAi(res, text);
			return;
		}
		sendJson(res, 200, {
			id: 'chatcmpl-mock',
			object: 'chat.completion',
			model: body.model || MODEL,
			choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
		});
		return;
	}

	if (req.method === 'POST' && url === '/api/chat') {
		const text = fakeTranslation(lastUserMessage(body));
		if (body.stream) {
			streamOllama(res, text);
			return;
		}
		sendJson(res, 200, {
			model: body.model || MODEL,
			message: { role: 'assistant', content: text },
			done: true,
		});
		return;
	}

	sendJson(res, 404, { error: { message: `mock server: no route for ${req.method} ${url}` } });
});

server.listen(PORT, '127.0.0.1', () => {
	process.stdout.write(
		[
			`mock model server listening on http://127.0.0.1:${PORT}`,
			'',
			'OpenAI compatible:',
			`  Base URL  http://127.0.0.1:${PORT}/v1`,
			`  Model     ${MODEL}`,
			'',
			'Ollama native:',
			`  Base URL  http://127.0.0.1:${PORT}`,
			`  Model     ${MODEL}`,
			'',
		].join('\n')
	);
});
