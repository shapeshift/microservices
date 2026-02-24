"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Enable CORS
    app.enableCors({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || [
            'http://localhost:3000',
            /\.shapeshift\.com$/,
        ],
        credentials: true,
    });
    app.getHttpAdapter().get('/health', (_, res) => {
        res.status(200).json({ status: 'ok' });
    });
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`User service is running on: http://localhost:${port}`);
}
bootstrap();
