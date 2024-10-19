import { v2 } from '@google-cloud/run';
import { GoogleAuth } from 'google-auth-library';

// Create a new GoogleAuth instance
const auth = new GoogleAuth();

// Get the current project ID from the environment
async function getProjectId() {
  const projectId = await auth.getProjectId();
  return projectId;
}

// Initialize the client using default credentials
const runClient = new v2.JobsClient({
  auth,
});

export interface IData {
  bucket: string;
  files: string[];
  name: string;
  notifyUrl: string;
  metadata: Record<string, any>,
}

export const zipFiles = async (data: IData) => {
  try {
    const projectId = await getProjectId();
    const execution = await runClient.runJob({
      name: `projects/${projectId}/locations/europe-west1/jobs/zoxxo-job`,
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: 'DATA', value: JSON.stringify(data, null, 2) }
            ]
          }
        ]
      }
    });
    console.log('zip job executed');
    return execution;
  } catch (e) {
    console.log(e);
  }
}
