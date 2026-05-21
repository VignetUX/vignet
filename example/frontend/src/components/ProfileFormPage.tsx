import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { TextField, Stack, CircularProgress } from '@mui/material';
import { Button } from './Button';

interface ProfileFormData {
  name: string;
  birthdate: string;
  occupation: string;
}

const EMPTY_FORM: ProfileFormData = { name: '', birthdate: '', occupation: '' };

export const ProfileFormPage = () => {
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<ProfileFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/getuserformdata/${id}`)
      .then(res => {
        if (!res.ok) return null;
        return res.json() as Promise<ProfileFormData>;
      })
      .then(data => {
        if (data) setForm(data);
      })
      .catch(() => {/* backend not available yet — leave form empty */})
      .finally(() => setLoading(false));
  }, [id]);

  const handleChange = (field: keyof ProfileFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = () => {
    console.log('Submitted:', form);
  };

  return (
    <div>
      <h1>Acme</h1>
      <main style={{ maxWidth: 480, margin: '48px auto', padding: '0 16px' }}>
        {loading ? (
          <Stack sx={{ alignItems: 'center', paddingTop: 6 }}>
            <CircularProgress />
          </Stack>
        ) : (
        <Stack spacing={3}>
          <TextField
            label="Name"
            value={form.name}
            onChange={handleChange('name')}
            fullWidth
          />
          <TextField
            label="Birthdate"
            type="date"
            value={form.birthdate}
            onChange={handleChange('birthdate')}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Occupation"
            value={form.occupation}
            onChange={handleChange('occupation')}
            fullWidth
          />
          <Button label="Submit" onClick={handleSubmit} />
        </Stack>
        )}
      </main>
    </div>
  );
};
