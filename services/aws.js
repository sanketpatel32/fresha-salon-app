const AWS = require('aws-sdk');
const dotenv = require('dotenv');
dotenv.config();

function uploadToS3(data, filename) {
    const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    });

    const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: filename,
        Body: data,
        ContentType: 'text/plain',
        ACL: 'public-read', // Make the file publicly readable
    };

    return new Promise((resolve, reject) => {
        s3.upload(params, (err, data) => {
            if (err) {
                console.error('Error uploading to S3:', err);
                reject(err);
            } else {
                // console.log('File uploaded successfully:', data.Location);
                resolve(data.Location); // Return the file URL
            }
        });
    });
}

module.exports = {
    uploadToS3,
};