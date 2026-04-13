const { Redis } = require('@upstash/redis');

// Criar cliente Redis Upstash usando variáveis de ambiente (seguro)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(400).json({
      error: 'Variáveis de ambiente Redis não configuradas',
      required: [
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN'
      ],
      hint: 'Configure essas variáveis no painel do Vercel (Settings > Environment Variables)'
    });
  }

  try {
    if (req.method === 'GET') {
      // Testar SET e GET
      await redis.set('foo', 'bar');
      const result = await redis.get('foo');
      
      return res.status(200).json({
        success: true,
        message: 'Conexão com Redis estabelecida',
        test: {
          set: { key: 'foo', value: 'bar' },
          get: result
        }
      });
    }

    if (req.method === 'POST') {
      // Testar escrita
      const { key = 'item', value = 'test-value' } = req.body || {};
      
      await redis.set(key, value);
      
      // Verificar se foi salvo
      const saved = await redis.get(key);
      
      return res.status(201).json({
        success: true,
        message: 'Dados salvos no Redis',
        key,
        value: saved
      });
    }

    return res.status(405).json({ error: 'Método não permitido' });

  } catch (error) {
    return res.status(500).json({
      error: 'Erro ao conectar ao Redis',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
