async function probeServer(runtime) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(runtime.timeoutMs, 15000));

  try {
    const response = await fetch(`${runtime.apiBaseUrl}/models`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = await response.json();
    const models = Array.isArray(data.data) ? data.data : [];
    const modelIds = models.map((item) => item.id).filter(Boolean);

    return {
      ok: true,
      modelCount: modelIds.length,
      modelFound: modelIds.includes(runtime.model)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function inferPriceFromImage(runtime, imageDataUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);

  const payload = {
    model: runtime.model,
    temperature: runtime.temperature,
    top_p: runtime.topP,
    max_tokens: runtime.maxTokens,
    seed: runtime.seed,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: runtime.prompt
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl
            }
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(`${runtime.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    const text = normalizeContent(content).trim();

    if (!text) {
      throw new Error('Пустой ответ модели.');
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join(' ');
  }

  return '';
}

module.exports = {
  probeServer,
  inferPriceFromImage
};