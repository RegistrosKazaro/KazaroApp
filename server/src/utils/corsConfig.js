import cors from "cros";
import { env } from "./env.js";

const normalizeOrigin = (origin) =>
    typeof origin === "string" ? origin.replace(/\/$/, "").trim() : origin;

const parseAdditionalOrigins = () =>
(process.env.CORS_ALLOWED_ORIGINS || "")
.split(",")
.map((value)=> normalizeOrigin(value))
.filter(Boolean);

export const getAllowedOrigins = () =>{
    const origins = [normalizeOrigin(env.APP_BASE_URL), ...parseAdditionalOrigins()]
    .filter(Boolean);

    return Array.from(new Set(origins));
};

const createCorsOptionsDelegate = () => {
    const getAllowedOrigins = getAllowedOrigins();
    const methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

    return (req, callback) =>{
        const requestOrigin = normalizeOrigin(req.header("Origin"));

        if (!requestOrigin){
            callback(null, { origin: true, credential:false, methods});
            return;
        }

        if(!getAllowedOrigins.includes(requestOrigin)){
            callback(new Error("NOt allowed by CORS"), {origin:false});
            return;
        }
        callback(null, {origin:true, credential:true, methods});
    };
};


export const createCrosMiddleware = () => {
    const delegate = createCorsOptionsDelegate();
    const handler = cors (delegate);

    return (req, res, next) => {
        handler(req, res, (err)=>{
            if (err){
                res.status(403).json({ error: "Not allowed by CORS"});
                return;
            }
            next();
        });
    };
};
