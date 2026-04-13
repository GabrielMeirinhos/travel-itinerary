const { createClient } = require('redis');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!process.env.REDIS_URL) {
    return res.status(400).json({
      error: 'REDIS_URL não configurada',
      hint: 'Configure a variável de ambiente REDIS_URL no Vercel'
    });
  }

  try {
    // Criar cliente Redis
    const redis = createClient({
      url: process.env.REDIS_URL
    });

    // Conectar
    await redis.connect();

    if (req.method === 'GET') {
      // Testar leitura
      const result = await redis.get('item');
      
      await redis.quit();
      
      return res.status(200).json({
        success: true,
        message: 'Conexão com Redis estabelecida',
        item: result
      });
    }

    if (req.method === 'POST') {
      // Testar escrita
      const { key = 'item', value = 'test-value' } = req.body || {};
      
      await redis.set(key, value);
      
      // Verificar se foi salvo
      const saved = await redis.get(key);
      
      await redis.quit();
      
      return res.status(201).json({
        success: true,
        message: 'Dados salvos no Redis',
        key,
        value: saved
      });
    }

    await redis.quit();
    return res.status(405).json({ error: 'Método não permitido' });

  } catch (error) {
    return res.status(500).json({
      error: 'Erro ao conectar ao Redis',
      message: error.message
    });
  }
};
