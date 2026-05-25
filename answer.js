// ========== 配置（改这里）==========
const DEEPSEEK_API_KEY = 'sk-7472f6be9ee345fd8de1e8e573095355'; // ← 替换！
const MODEL = 'deepseek-v4-flash';        // deepseek-chat 或 deepseek-reasoner
const MAX_TOKENS = 5000;
const TEMPERATURE = 0.1;
const TIMEOUT_MS = 15000;
// ===================================

function buildSystemPrompt(type) {
    const map = {
        single:     '你是一个答题助手。请从选项中选出唯一正确答案。只需给出选项字母（如 A），不要任何解释。',
        multiple:   '你是一个答题助手。请从选项中选出所有正确答案。只需给出选项字母，多个用 # 分隔（如 A#C#D），不要任何解释。',
        judge:      '你是一个答题助手。请判断题干说法是否正确。只回复"正确"或"错误"，不要任何解释。',
        completion: '你是一个答题助手。请直接给出填空题的答案，简洁准确，不要任何解释。',
    };
    return map[type] || map.single;
}

function buildUserPrompt(type, title, options) {
    let prompt = `【题目】${title}\n`;
    if (options && options.trim()) {
        prompt += `\n【选项】\n${options}\n`;
    }
    const tail = {
        single:     '\n请选出唯一正确答案，只回复选项字母。',
        multiple:   '\n请选出所有正确答案，用 # 分隔（如 A#C#D），只回复字母。',
        judge:      '\n请判断对错，只回复"正确"或"错误"。',
        completion: '\n请给出答案，不要多余内容。',
    };
    return prompt + (tail[type] || tail.single);
}

function parseAnswer(type, rawText) {
    const text = rawText.trim();
    switch (type) {
        case 'single': {
            const m = text.match(/[A-Za-z]/);
            return m ? m[0].toUpperCase() : '';
        }
        case 'multiple': {
            // 用 # 分隔，符合 OCS 多选题规范
            const letters = text.match(/[A-Za-z]/g);
            return letters ? [...new Set(letters.map(c => c.toUpperCase()))].join('#') : '';
        }
        case 'judge':
            return /正确|对|是|true|yes/i.test(text) ? '正确' : '错误';
        case 'completion':
            return text;
        default:
            return text;
    }
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: 0, msg: 'Method Not Allowed' });

    try {
        const { title, type, options } = req.body || {};
        if (!title) return res.status(400).json({ code: 0, msg: 'Missing title' });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: buildSystemPrompt(type) },
                    { role: 'user', content: buildUserPrompt(type, title, options) },
                ],
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE,
                stream: false,
            }),
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[DeepSeek Error]', errText);
            return res.status(resp.status).json({ code: 0, msg: errText });
        }

        const data = await resp.json();
        const rawAnswer = data.choices[0].message.content.trim();
        const answer = parseAnswer(type, rawAnswer);

        console.log(`[OK] ${title.substring(0, 30)}... → ${answer}`);

        // 返回 OCS 兼容格式
        return res.status(200).json({ code: 1, answer });

    } catch (err) {
        console.error('[Error]', err.message);
        return res.status(500).json({ code: 0, msg: err.message });
    }
}
