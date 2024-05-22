import { createServer } from 'http';
import { handler } from './src/handler';
import { options } from './src/config';

createServer(handler).listen(options.port);
