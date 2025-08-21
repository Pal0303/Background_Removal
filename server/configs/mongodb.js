import mongoose from "mongoose";

let isConnected = false;
let connectionPromise = null;

const connectDB = async () => {
  if (isConnected) {
    return;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = new Promise(async (resolve, reject) => {
    try {
      mongoose.connection.on('connected', () => {
        console.log('Database connected successfully');
        isConnected = true;
        resolve();
      });

      mongoose.connection.on('error', (err) => {
        console.error('Database connection error:', err);
        reject(err);
      });

      mongoose.connection.on('disconnected', () => {
        console.log('Database disconnected');
        isConnected = false;
        connectionPromise = null;
      });

      await mongoose.connect(`${process.env.MONGODB_URI}/bg-removal`, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000, 
        socketTimeoutMS: 45000,
        retryWrites: true,
        retryReads: true,
      });
    } catch (error) {
      console.error('Database connection failed:', error.message);
      connectionPromise = null;
      reject(error);
    }
  });

  return connectionPromise;
};

export default connectDB;