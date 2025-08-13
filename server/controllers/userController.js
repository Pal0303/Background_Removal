import { Webhook } from "svix"
import userModel from "../models/userModel.js"

const clerkWebhooks = async (req, res) => {
    try {
        const whook = new Webhook(process.env.CLERK_WEBHOOK_SECRET)
        await whook.verify(JSON.stringify(req.body), {
            "svix-id": req.headers["svix-id"],
            "svix-signature": req.headers["svix-signature"],
            "svix-timestamp": req.headers["svix-timestamp"]
        })

        const { data, type } = req.body

        switch (type) {
            case "user.created": {
                const userData = {
                    clerkId: data.id,
                    email: data.email_addresses[0].email_address,
                    photo: data.image_url,
                    firstName: data.first_name,
                    lastName: data.last_name
                }

                await userModel.create(userData)
                res.JSON({})
                break;
            }
            case "user.updated": {
                const userData = {
                    email: data.email_addresses[0].email_address,
                    photo: data.image_url,
                    firstName: data.first_name,
                    lastName: data.last_name
                }

                await userModel.findOneAndUpdate({ clerkId: data.id }, userData)
                res.JSON({})
                break;
            }
            case "user.deleted": {
                await userModel.findOneAndDelete({ clerkId: data.id })
                res.JSON({})
                break;
            }
            default:
                break;
        }
    } catch (error) {

    }
}

export { clerkWebhooks } 