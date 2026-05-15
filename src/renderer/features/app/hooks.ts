import { QUERY_KEYS } from '@shared/constants';
import { useQuery } from '@tanstack/react-query';
import { getAppVersion } from './api';

export const useAppVersion = () =>
  useQuery({
    queryKey: QUERY_KEYS.app.version,
    queryFn: getAppVersion,
    staleTime: Number.POSITIVE_INFINITY,
  });
