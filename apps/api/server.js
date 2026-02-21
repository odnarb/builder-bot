import { app } from './index.js';
import logger from './utils/logger.js';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    logger.info('API server started', {
        port: Number(PORT),
        url: `http://localhost:${PORT}`,
    });
});
