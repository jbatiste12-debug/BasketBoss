import {servePublicLegal} from '../bb-server-lib/bb-public-legal.js';
export const onRequest=context=>servePublicLegal(context,'terms');
