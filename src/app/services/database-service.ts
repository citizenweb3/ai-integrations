import { queryClient } from '@/db';

const close = async (): Promise<void> => {
  await queryClient.end();
};

const databaseService = {
  close,
};

export default databaseService;
