import mongoose from "mongoose";

const connectDB = async () => {
    try {
        if (mongoose.connection.readyState >= 1) {
            console.log('Database already connected');
            return;
        }

        mongoose.connection.on('connected', () => {
            console.log('Database connected successfully');
        });

        mongoose.connection.on('error', (err) => {
            console.error('Database connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('Database disconnected');
        });

        const conn = await mongoose.connect(`${process.env.MONGODB_URI}/bg-removal`, {
            maxPoolSize: 10,
            minPoolSize: 2,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 5000, 
            socketTimeoutMS: 45000,

            bufferMaxEntries: 0,
            bufferCommands: false,
            
            writeConcern: {
                w: 'majority',
                j: true,
                wtimeout: 5000
            }
        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);
        
    } catch (error) {
        console.error('Database connection failed:', error.message);
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        }
        throw error;
    }
};

export default connectDB;