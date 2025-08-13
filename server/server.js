import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './configs/mongodb.js'
import userRouter from './routes/userRoutes.js'

const PORT = process.env.PORT || 4000
const app = express()
await connectDB().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
});

app.use(express.json())
app.use(cors())

app.get('/', (req, res) => res.send('API working'))
app.use('/api/user', userRouter)
app.listen(PORT, () => console.log('Server is running on port: '+PORT));