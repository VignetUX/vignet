import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProfileFormPage } from './ProfileFormPage'

const SAMPLE_DATA = {
  name: 'Jane Doe',
  birthdate: '1990-06-15',
  occupation: 'Software Engineer',
}

// Wrapper that supplies router context, required because ProfileFormPage uses
// useParams. story() registers this wrapper as the workshop component.
const ProfileFormPageStory = ({ id }: { id?: string }) => (
  <MemoryRouter initialEntries={id ? [`/userform/${id}`] : ['/userform']}>
    <Routes>
      <Route path="/userform/:id" element={<ProfileFormPage />} />
      <Route path="/userform" element={<ProfileFormPage />} />
    </Routes>
  </MemoryRouter>
)

function renderAtRoute(id?: string) {
  return render(<ProfileFormPageStory id={id} />)
}

function mockFetch(ok: boolean, data: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: async () => data,
  } as Response)
}

describe('ProfileFormPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the header', { meta: { vignet: { name: 'Header' } } }, () => {
    renderAtRoute()
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument()
  })

  it('shows an empty form when no id is in the url', { meta: { vignet: { name: 'Empty form' } } }, () => {
    render(<ProfileFormPage />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Occupation')).toHaveValue('')
  })

  it('shows a loading spinner while fetching', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    renderAtRoute('123');
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('pre-fills the form with data returned from the backend', { meta: { vignet: { name: 'Pre-filled form' } } }, async () => {
    mockFetch(true, SAMPLE_DATA)
    renderAtRoute('123')
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Name')).toHaveValue('Jane Doe')
    expect(screen.getByLabelText('Occupation')).toHaveValue('Software Engineer')
    expect(screen.getByLabelText('Birthdate')).toHaveValue('1990-06-15')
  })

  it('shows an empty form when the backend returns 404', async () => {
    mockFetch(false, { error: 'User not found' })
    renderAtRoute('999')
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Occupation')).toHaveValue('')
  })

  it('shows an empty form when the fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    renderAtRoute('123')
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('updates fields as the user types', async () => {
    renderAtRoute()
    await userEvent.type(screen.getByLabelText('Name'), 'John Smith')
    await userEvent.type(screen.getByLabelText('Occupation'), 'Designer')
    expect(screen.getByLabelText('Name')).toHaveValue('John Smith')
    expect(screen.getByLabelText('Occupation')).toHaveValue('Designer')
  })

  it('renders the submit button', () => {
    renderAtRoute()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })
})
