export const buildResponse = ({
    res,
    status = 200,
    message,
    data,
    extra = {}
}) => {
    return res.status(status).json({
        success: true,
        status,
        message,
        ...extra,
        data,
        timestamp: new Date().toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata"
        })
    });
};