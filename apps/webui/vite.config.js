// vite.config.js
export default {
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3001', // your backend port
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api/, ''),
            },
        },
    },
};
